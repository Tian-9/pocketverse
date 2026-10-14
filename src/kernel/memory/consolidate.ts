import { ulid } from 'ulid';
import { parseBag, rebuildIndex } from 'annals';
import { BAG_SCHEMA, PATCHES_SCHEMA, parsePatches } from 'annals/airp';
import { db } from '../storage/db';
import { applyPatches, stateLines } from './state';
import { toUserMacro } from '../context/userref';
import { repo } from '../data/repo';
import { dayDivider, dayOf, memoryWhen, storyStartOf } from '../context/days';
import type { Campaign, Character, EpisodicMemory, LoreEntry, LoreOverlay, Message } from '../storage/db';
import { textOf } from '../data/repo';
import { loreApplies } from '../data/lore';
import { llm } from '../llm/gateway.svelte';
import { bus } from '../bus/bus';
import { expandMacros } from '../context/macros';
import { clock } from '../context/clock';
import { log } from '../log/log';

export const CONSOLIDATE_EVERY = 12; // 每多少条新的角色回复合并一次

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memories', 'state', 'patches', 'overlays'],
  properties: {
    memories: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['text', 'day', 'when', 'importance', 'bag'], properties: {
      text: { type: 'string', description: '一两句话，第三人称，写清楚谁对谁做了什么' },
      day: { type: 'integer', description: '这件事发生在第几天：照抄对话记录里它上方最近那条「—— Day N ——」分隔行的 N' },
      when: { type: 'string', description: '一天里的时段，如「早上」「放学后」「半夜」，可空。不写日期、不写「今天」「昨天」，哪天由 day 定' },
      importance: { type: 'integer', minimum: 1, maximum: 3, description: '3=改变关系或剧情走向的大事，2=值得记住，1=日常' },
      bag: { ...BAG_SCHEMA, description: '这条记忆的检索词，三档。只放名词和具体的动词。core 是主体和关键物件（含外号、别名），related 是具体的动作和地点，hint 是别人可能用来问起这件事的词。不放功能词、代词、时间词、泛泛的动词。优先复用「已有检索词」' },
    } } },
    patches: { ...PATCHES_SCHEMA, description: '当前状态的变化：位置、归属、生死、关系、欠款、承诺、不可逆的外貌。只填确实变了的，和「当前状态」里一样的不要重复；没变化给空数组' },
    state: { type: 'object', additionalProperties: false, properties: {
      location: { type: 'string' }, relation: { type: 'string' }, mood: { type: 'string' },
    } },
    overlays: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['title', 'summary', 'content'], properties: {
      loreEntryId: { type: 'string', description: '被改变的世界书条目 id；新增事实留空字符串' },
      title: { type: 'string' }, summary: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' },
    } } },
  },
};

export interface ConsolidateOutput {
  memories: { text: string; day?: number; when: string; importance: 1 | 2 | 3; bag?: unknown }[];
  state: { location?: string; relation?: string; mood?: string };
  /** 状态 patch，形状见 annals/airp 的 PATCHES_SCHEMA；代码侧 parsePatches 防呆 */
  patches?: unknown;
  overlays: { loreEntryId?: string; title: string; summary: string; content: string; reason?: string }[];
}

export function buildPrompt(campaign: Campaign, character: Character, lore: LoreEntry[], msgs: Message[], existing: EpisodicMemory[], extra: { stateLines?: string[]; vocab?: string[] } = {}) {
  // 跨天的地方插一行「—— Day N · 11/14 周五 ——」：模型照抄 N，日期和天数由代码算，不让它做日期算术
  const start = storyStartOf(campaign), tz = character.timeZone;
  const lines: string[] = [];
  let lastDay: number | null = null;
  for (const m of msgs.filter((x) => x.role !== 'system')) {
    const ts = m.storyTs ?? m.ts;
    const d = dayOf(ts, start, tz);
    if (d !== lastDay) { lines.push(dayDivider(ts, start, tz)); lastDay = d; }
    lines.push(`${m.role === 'user' ? '{{user}}' : '{{char}}'}：${textOf(m)}`);
  }
  const transcript = lines.join('\n');
  const dir = lore.map((e) => `- [${e.id}] ${e.title}：${e.summary}`).join('\n');
  const nowTs = clock.now(campaign.clock);
  const prior = existing.slice(-15).map((m) => `- ${memoryWhen(m, start, nowTs, tz)}：${m.text}`).join('\n');
  const s = campaign.state;
  return {
    system: `你是角色扮演对话的记忆整理员。读下面这段对话，提取值得长期记住的内容，输出 JSON。
规则：
- memories：只记发生了的事和透露的信息，不记寒暄。已经在"已有记忆"里的不要重复。
- state：只填确实变化了的字段，没变就不填。
- patches：当前仍然成立的硬事实的变化：东西在哪、归谁、谁欠谁多少、谁答应了什么、关系的定性。一条一个 entity+attr，value 写成主宾分明的一句话（"{{char}} 欠 {{user}} 49.5 元"，不写"欠了钱"）；剧情没说清的写"未明确（原因）"。和「当前状态」里相同的不要再给。
- 每条 memory 的 day 照抄它上方最近那条「—— Day N ——」分隔行的 N；when 只写一天里的时段。
- 每条 memory 都要给 bag，只放名词和具体的动词：人（含外号、别名）、东西、地点、事情的叫法（物理卷子、唱片店、烤冷面），只有这件事才有的动作（偷吃、借钱、表白）。core 最多 3 个，是这件事的主体和关键物件；related 是具体的动作、地点；hint 是别人可能用来问起这件事的说法。「已有检索词」里有的优先用同一个词。
- bag 里不要放：功能词（的、了、吗、这个、什么）、代词（我、你、他）、{{user}} 的名字（每条都跟他有关，写了等于没写）、时间词（昨天、今天、明早、晚上、Day 几——时间由 day 和 when 记）、什么事都能用上的动词和形容词（说、去、买、看、想、打算、觉得、开心、很好）。
- overlays：只有当剧情明确改变了世界书里的设定或世界本身时才填，宁缺毋滥。
- 称呼对方一律用名字「{{user}}」，不要写「用户」。
- 全部用中文。`,
    user: `# 角色\n${character.name}：${character.core.slice(0, 600)}\n\n# 当前状态\n时间：${clock.format(clock.now(campaign.clock), character.timeZone)}；地点：${s.location ?? '未知'}；关系：${s.relations[character.id] ?? '未知'}；情绪：${s.mood[character.id] ?? '未知'}\n事实：\n${[...(extra.stateLines ?? []), ...s.facts].map((f) => '- ' + f).join('\n') || '（无）'}\n\n# 已有检索词\n${(extra.vocab ?? []).join('、') || '（无）'}\n\n# 世界书目录\n${dir || '（无）'}\n\n# 已有记忆（最近）\n${prior || '（无）'}\n\n# 需要整理的对话\n${transcript}`,
  };
}

/**
 * days：这批对话里每一天（Day N）最后一条消息的剧情时刻。模型给的 day 在里面就用那天的时刻，不在（编的、抄错的）就用 at（最后一条）。
 */
export async function applyOutput(campaign: Campaign, character: Character, lore: LoreEntry[], out: ConsolidateOutput, sourceIds: string[], at = clock.now(campaign.clock), userName?: string, days: Map<number, number> = new Map()) {
  const now = Date.now();
  // 存库前名字和「用户」换成 {{user}}：改名后旧记忆自动跟着变，也不会把「用户」喂回给聊天模型
  const u = (t: string) => toUserMacro(t, userName);
  // schema 里的条数上限发给 API 时会被剥掉（结构化输出不支持），这里兜底
  const mems: EpisodicMemory[] = (out.memories ?? []).filter((m) => m.text?.trim()).slice(0, 12).map((m) => ({
    id: ulid(), campaignId: campaign.id, characterId: character.id, when: u(m.when ?? ''), text: u(m.text.trim()),
    importance: ([1, 2, 3].includes(m.importance) ? m.importance : 2) as 1 | 2 | 3, sourceMessageIds: sourceIds, createdAt: now,
    storyTs: days.get(Number(m.day)) ?? at,
    bag: parseBag(m.bag),
  }));
  if (mems.length) await db().memories.bulkAdd(mems);

  const st = out.state ?? {};
  const state = { ...campaign.state, relations: { ...campaign.state.relations }, mood: { ...campaign.state.mood } };
  if (st.location) state.location = u(st.location);
  if (st.relation) state.relations[character.id] = u(st.relation);
  if (st.mood) state.mood[character.id] = u(st.mood);
  // 硬事实走 annals 状态事件：来源挂这批的最后一条消息，删了它或重新生成就一起撤回
  const patches = await applyPatches(campaign.id, parsePatches(out.patches).map((p) => ({ ...p, entity: u(p.entity), value: u(p.value) })), { source: sourceIds[sourceIds.length - 1] ?? 'consolidate', at });

  const overlays: LoreOverlay[] = (out.overlays ?? []).filter((o) => o.title && o.content).slice(0, 5).map((o) => ({
    id: ulid(), campaignId: campaign.id, loreEntryId: o.loreEntryId && lore.some((e) => e.id === o.loreEntryId) ? o.loreEntryId : undefined,
    title: u(o.title), summary: u(o.summary ?? ''), content: u(o.content), reason: u(o.reason ?? ''), createdAt: now, pending: true,
  }));
  if (overlays.length) await db().overlays.bulkAdd(overlays);
  return { mems, state, overlays, patches };
}

const inflight = new Set<string>();

/** 对一个会话做一次合并：处理 consolidatedUpTo 之后的消息。 */
export async function consolidate(conversationId: string, opts: { force?: boolean; reason?: string } = {}): Promise<boolean> {
  if (inflight.has(conversationId)) { log.info('consolidate', '跳过：上一次还在进行', { conversationId }); return false; }
  // 在第一次 await 之前占位：两次检查几乎同时进来时，后一次必须看到前一次，否则同一批消息会发两次
  inflight.add(conversationId);
  try { return await run(conversationId, opts); }
  finally { inflight.delete(conversationId); }
}

async function run(conversationId: string, opts: { force?: boolean; reason?: string }): Promise<boolean> {
  const conv = await db().conversations.get(conversationId);
  if (!conv) return false;
  const campaign = await db().campaigns.get(conv.campaignId);
  const character = conv.participantIds[0] ? await db().characters.get(conv.participantIds[0]) : undefined;
  if (!campaign || !character || !llm.configured) return false;
  const since = campaign.consolidatedUpTo ?? 0;
  const msgs = (await db().messages.where('conversationId').equals(conversationId).sortBy('ts')).filter((m) => m.ts > since);
  const replies = msgs.filter((m) => m.role === 'assistant').length;
  if (!opts.force && replies < CONSOLIDATE_EVERY) return false;
  if (replies === 0) return false;
  const lastTs = msgs[msgs.length - 1]!.ts;
  // 上次失败（出错、或你在预览里取消了）的那批不立刻重试：等失败点之后再攒够一批回复。刷新页面也不会重来，这个标记存在库里。
  const failedAt = campaign.consolidateFailedAt ?? 0;
  if (!opts.force && failedAt) {
    const sinceFail = msgs.filter((m) => m.ts > failedAt && m.role === 'assistant').length;
    if (sinceFail < CONSOLIDATE_EVERY) { log.info('consolidate', `跳过：上次失败后只有 ${sinceFail} 条新回复，攒够 ${CONSOLIDATE_EVERY} 条再试`, { conversationId }); return false; }
  }

  const t0 = Date.now();
  log.info('consolidate', `开始：${character.name}，${msgs.length} 条消息（${replies} 条回复），触发：${opts.reason ?? (opts.force ? '手动' : '未知')}`, { conversationId, since });
  try {
    const lore = await db().lore.filter((e) => e.enabled && e.kind !== 'style' && loreApplies(e, campaign.worldId, [character.id])).toArray();
    const existing = await db().memories.where('campaignId').equals(campaign.id).sortBy('createdAt');
    // 已有词表给模型复用，词表才会收敛到这一局自己的说法
    const vocab = rebuildIndex(existing, (m) => (m.bag ? { id: m.id, bag: m.bag } : null)).vocabulary().slice(0, 60).map((v) => v.term);
    const prompt0 = buildPrompt(campaign, character, lore, msgs, existing, { stateLines: await stateLines(campaign.id), vocab });
    const userName = await repo.userNameOf(campaign);
    const names = { user: userName, char: character.name };
    const prompt = { system: expandMacros(prompt0.system, names), user: expandMacros(prompt0.user, names) };
    const r = await llm.chat({
      maxTokens: 4000, purpose: 'consolidate', conversationId,
      system: [{ type: 'text', text: prompt.system }], messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
      jsonSchema: SCHEMA,
    });
    let out: ConsolidateOutput;
    try { out = JSON.parse(r.text) as ConsolidateOutput; }
    catch {
      await db().campaigns.update(campaign.id, { consolidateFailedAt: lastTs });
      log.error('consolidate', '模型没有返回合法 JSON，这批消息不再自动重试', { conversationId, stopReason: r.stopReason, head: r.text.slice(0, 120) });
      return false;
    }
    const last = msgs[msgs.length - 1]!;
    // 每一天最后一条消息的剧情时刻：模型给的 day 落到这里
    const start = storyStartOf(campaign), days = new Map<number, number>();
    for (const m of msgs) { const ts = m.storyTs ?? m.ts; days.set(dayOf(ts, start, character.timeZone), ts); }
    const { mems, state, overlays, patches } = await applyOutput(campaign, character, lore, out, msgs.map((m) => m.id), last.storyTs ?? clock.now(campaign.clock), userName, days);
    await db().campaigns.update(campaign.id, { state, consolidatedUpTo: lastTs, consolidateFailedAt: undefined });
    log.info('consolidate', `完成：${mems.length} 条记忆，${patches.length} 条状态，${overlays.length} 条变化，${Date.now() - t0} ms`, { conversationId });
    bus.emit('memory.consolidated', { campaignId: campaign.id, memories: mems.length, overlays: overlays.length });
    if (overlays.length) bus.emit('notify', { title: `${character.name} 的世界有 ${overlays.length} 处变化待确认`, body: overlays[0]!.title, pluginId: 'lore', screen: 'overlays' });
    return true;
  } catch (e) {
    await db().campaigns.update(campaign.id, { consolidateFailedAt: lastTs });
    log.error('consolidate', `失败：${e instanceof Error ? e.message : String(e)}，这批消息不再自动重试`, { conversationId });
    throw e;
  }
}

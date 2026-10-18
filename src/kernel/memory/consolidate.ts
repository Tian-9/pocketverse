import { ulid } from 'ulid';
import { parseBag, rebuildIndex } from 'annals';
import { BAG_SCHEMA, PATCHES_SCHEMA, parsePatches } from 'annals/state';
import { db } from '../storage/db';
import { applyPatches, loadState, retractSource, stateLines } from './state';
import { toUserMacro } from '../context/userref';
import { repo } from '../data/repo';
import { dayDivider, dayOf, memoryWhen, storyStartOf } from '../context/days';
import type { Campaign, Character, ConsolidateBatch, EpisodicMemory, LoreEntry, LoreOverlay, Message } from '../storage/db';
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
  /** 状态 patch，形状见 annals/state 的 PATCHES_SCHEMA；代码侧 parsePatches 防呆 */
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
export async function applyOutput(campaign: Campaign, character: Character, lore: LoreEntry[], out: ConsolidateOutput, sourceIds: string[], at = clock.now(campaign.clock), userName?: string, days: Map<number, number> = new Map(), opts: { redo?: boolean; createdAt?: number } = {}) {
  const now = opts.createdAt ?? Date.now();
  // 批次 id：这批最后一条消息的 id。记忆的 sourceMessageIds 最后一个、硬事实的 source、世界变化的 sourceId 都是它，撤回整批按它找
  const batchId = sourceIds[sourceIds.length - 1] ?? 'consolidate';
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

  // 重整老批次时不动地点、关系、情绪：那是「现在」的样子，老对话里的会盖掉新的
  const st = opts.redo ? {} : out.state ?? {};
  const state = { ...campaign.state, relations: { ...campaign.state.relations }, mood: { ...campaign.state.mood } };
  if (st.location) state.location = u(st.location);
  if (st.relation) state.relations[character.id] = u(st.relation);
  if (st.mood) state.mood[character.id] = u(st.mood);
  // 硬事实走 annals 状态事件：来源挂这一批，删了其中的消息或重新生成就一起撤回
  let parsed = parsePatches(out.patches).map((p) => ({ ...p, entity: u(p.entity), value: u(p.value) }));
  if (opts.redo) {
    // 重整老批次：这批之后又改过的条目不补，不然老结论会盖掉新的
    const later = new Set((await loadState(campaign.id)).filter((e) => e.at > at).map((e) => `${e.payload.entity}\u0000${e.payload.attr}`));
    parsed = parsed.filter((p) => !later.has(`${p.entity}\u0000${p.attr}`));
  }
  const patches = await applyPatches(campaign.id, parsed, { source: batchId, at });

  const overlays: LoreOverlay[] = (out.overlays ?? []).filter((o) => o.title && o.content).slice(0, 5).map((o) => ({
    id: ulid(), campaignId: campaign.id, loreEntryId: o.loreEntryId && lore.some((e) => e.id === o.loreEntryId) ? o.loreEntryId : undefined,
    title: u(o.title), summary: u(o.summary ?? ''), content: u(o.content), reason: u(o.reason ?? ''), createdAt: now, pending: true, sourceId: batchId,
  }));
  if (overlays.length) await db().overlays.bulkAdd(overlays);
  return { mems, state, overlays, patches };
}

/**
 * 删到已经整理过的消息：撤回它所在的整批（那批的记忆、硬事实、还没确认的世界变化），范围记进 redo，
 * 下次整理检查时把剩下的消息重整一遍。同批其他回复的记忆不会白白丢掉，代价是一次整理档调用（ARCHITECTURE 5.12）。
 */
export async function unconsolidate(campaignId: string, deleted: Message[]): Promise<void> {
  const cp = await db().campaigns.get(campaignId);
  const hit = cp ? deleted.filter((m) => m.ts <= consolidatedOf(cp, m.conversationId).upTo) : [];
  if (!cp || !hit.length) return;
  const batches = cp.batches ?? [];
  const gone = batches.filter((b) => hit.some((m) => m.conversationId === b.conversationId && m.ts > b.from && m.ts <= b.to));
  if (!gone.length) return;
  const ids = new Set(gone.map((b) => b.id));
  const mems = await db().memories.where('campaignId').equals(campaignId).filter((m) => ids.has(m.sourceMessageIds?.at(-1) ?? '')).primaryKeys();
  if (mems.length) await db().memories.bulkDelete(mems);
  for (const id of ids) await retractSource(campaignId, id);
  const ovs = await db().overlays.where('campaignId').equals(campaignId).filter((o) => !!o.pending && !!o.sourceId && ids.has(o.sourceId)).primaryKeys();
  if (ovs.length) await db().overlays.bulkDelete(ovs);
  await db().campaigns.update(campaignId, {
    batches: batches.filter((b) => !ids.has(b.id)),
    redo: [...(cp.redo ?? []), ...gone.map((b) => ({ conversationId: b.conversationId, from: b.from, to: b.to }))],
  });
  bus.emit('memory.written', { kind: 'episodic', id: campaignId });
  log.info('consolidate', `删到了整理过的消息：撤回 ${gone.length} 批（${mems.length} 条记忆），下次整理时重整`, { campaignId });
}

/** 记一批：按时间排，最多留 300 批 */
function withBatch(cp: Campaign, b: ConsolidateBatch): ConsolidateBatch[] {
  return [...(cp.batches ?? []).filter((x) => x.id !== b.id), b].sort((x, y) => x.to - y.to).slice(-300);
}

const inflight = new Set<string>();

/** 这条会话的整理进度（ARCHITECTURE 6.1：线上线下各一条，进度按会话记） */
export const consolidatedOf = (cp: Campaign, conversationId: string) => cp.consolidated?.[conversationId] ?? { upTo: 0 };
const setConsolidated = (cp: Campaign, conversationId: string, v: { upTo: number; failedAt?: number }) => ({ consolidated: { ...(cp.consolidated ?? {}), [conversationId]: v } });

/** 对一个会话做一次合并：处理这条会话整理进度之后的消息。 */
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
  let campaign = await db().campaigns.get(conv.campaignId);
  const character = conv.participantIds[0] ? await db().characters.get(conv.participantIds[0]) : undefined;
  if (!campaign || !character || !llm.configured) return false;
  const all = await db().messages.where('conversationId').equals(conversationId).sortBy('ts');

  // 先重整删过消息的批次：不管攒没攒够，整理进度不动
  for (const r of (campaign.redo ?? []).filter((x) => x.conversationId === conversationId)) {
    const msgs = all.filter((m) => m.ts > r.from && m.ts <= r.to);
    const drop = async (batch?: ConsolidateBatch) => {
      const cp = (await db().campaigns.get(campaign!.id))!;
      await db().campaigns.update(cp.id, { redo: (cp.redo ?? []).filter((x) => !(x.conversationId === r.conversationId && x.from === r.from && x.to === r.to)), ...(batch ? { batches: withBatch(cp, batch) } : {}) });
    };
    if (!msgs.some((m) => m.role === 'assistant')) { await drop(); continue; }
    log.info('consolidate', `重整：${msgs.length} 条消息（有消息被删过）`, { conversationId });
    const done = await extract(campaign, character, conversationId, msgs, true);
    // 模型没给合法 JSON 也丢掉这个范围，不反复重试；出错（断网）就抛出去，下次再来
    await drop(done ? { id: msgs[msgs.length - 1]!.id, conversationId, from: r.from, to: r.to } : undefined);
    campaign = (await db().campaigns.get(campaign.id))!;
  }

  const progress = consolidatedOf(campaign, conversationId);
  const since = progress.upTo;
  const msgs = all.filter((m) => m.ts > since);
  const replies = msgs.filter((m) => m.role === 'assistant').length;
  if (!opts.force && replies < CONSOLIDATE_EVERY) return false;
  if (replies === 0) return false;
  const lastTs = msgs[msgs.length - 1]!.ts;
  // 上次失败（出错、或你在预览里取消了）的那批不立刻重试：等失败点之后再攒够一批回复。刷新页面也不会重来，这个标记存在库里。
  const failedAt = progress.failedAt ?? 0;
  if (!opts.force && failedAt) {
    const sinceFail = msgs.filter((m) => m.ts > failedAt && m.role === 'assistant').length;
    if (sinceFail < CONSOLIDATE_EVERY) { log.info('consolidate', `跳过：上次失败后只有 ${sinceFail} 条新回复，攒够 ${CONSOLIDATE_EVERY} 条再试`, { conversationId }); return false; }
  }

  log.info('consolidate', `开始：${character.name}，${msgs.length} 条消息（${replies} 条回复），触发：${opts.reason ?? (opts.force ? '手动' : '未知')}`, { conversationId, since });
  try {
    const done = await extract(campaign, character, conversationId, msgs, false);
    const cp = (await db().campaigns.get(campaign.id))!;
    if (!done) { await db().campaigns.update(campaign.id, setConsolidated(cp, conversationId, { upTo: since, failedAt: lastTs })); return false; }
    await db().campaigns.update(campaign.id, { state: done.state, ...setConsolidated(cp, conversationId, { upTo: lastTs }), batches: withBatch(cp, { id: msgs[msgs.length - 1]!.id, conversationId, from: since, to: lastTs }) });
    return true;
  } catch (e) {
    const cp = (await db().campaigns.get(campaign.id))!;
    await db().campaigns.update(campaign.id, setConsolidated(cp, conversationId, { upTo: since, failedAt: lastTs }));
    log.error('consolidate', `失败：${e instanceof Error ? e.message : String(e)}，这批消息不再自动重试`, { conversationId });
    throw e;
  }
}

/** 调整理档模型整理一批消息并落库。模型没给合法 JSON 返回 null */
async function extract(campaign: Campaign, character: Character, conversationId: string, msgs: Message[], redo: boolean) {
  const t0 = Date.now();
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
    log.error('consolidate', '模型没有返回合法 JSON，这批消息不再自动重试', { conversationId, stopReason: r.stopReason, head: r.text.slice(0, 120) });
    return null;
  }
  const last = msgs[msgs.length - 1]!;
  // 每一天最后一条消息的剧情时刻：模型给的 day 落到这里
  const start = storyStartOf(campaign), days = new Map<number, number>();
  for (const m of msgs) { const ts = m.storyTs ?? m.ts; days.set(dayOf(ts, start, character.timeZone), ts); }
  // 重整的记忆按那批最后一条消息的时间排，不当成最新的
  const res = await applyOutput(campaign, character, lore, out, msgs.map((m) => m.id), last.storyTs ?? clock.now(campaign.clock), userName, days, redo ? { redo: true, createdAt: last.ts } : {});
  log.info('consolidate', `${redo ? '重整' : '完成'}：${res.mems.length} 条记忆，${res.patches.length} 条状态，${res.overlays.length} 条变化，${Date.now() - t0} ms`, { conversationId });
  bus.emit('memory.consolidated', { campaignId: campaign.id, memories: res.mems.length, overlays: res.overlays.length });
  if (res.overlays.length) bus.emit('notify', { title: `${character.name} 的世界有 ${res.overlays.length} 处变化待确认`, body: res.overlays[0]!.title, pluginId: 'lore', screen: 'overlays' });
  return res;
}

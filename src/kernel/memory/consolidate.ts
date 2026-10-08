import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { Campaign, Character, EpisodicMemory, LoreEntry, LoreOverlay, Message } from '../storage/db';
import { textOf } from '../data/repo';
import { llm } from '../llm/gateway.svelte';
import { bus } from '../bus/bus';
import { expandMacros } from '../context/macros';

export const CONSOLIDATE_EVERY = 12; // 每多少条新的角色回复合并一次
export const CONSOLIDATE_MODEL = 'claude-haiku-5-5';

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memories', 'state', 'overlays'],
  properties: {
    memories: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['text', 'when', 'importance'], properties: {
      text: { type: 'string', description: '一两句话，第三人称，写清楚谁对谁做了什么' },
      when: { type: 'string', description: '剧情时间，不确定就写相对时间，如"今天下午"' },
      importance: { type: 'integer', minimum: 1, maximum: 3, description: '3=改变关系或剧情走向的大事，2=值得记住，1=日常' },
    } } },
    state: { type: 'object', additionalProperties: false, properties: {
      inWorldTime: { type: 'string' }, location: { type: 'string' }, relation: { type: 'string' }, mood: { type: 'string' },
      facts: { type: 'array', maxItems: 20, items: { type: 'string' } },
    } },
    overlays: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['title', 'summary', 'content'], properties: {
      loreEntryId: { type: 'string', description: '被改变的世界书条目 id；新增事实留空字符串' },
      title: { type: 'string' }, summary: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' },
    } } },
  },
};

export interface ConsolidateOutput {
  memories: { text: string; when: string; importance: 1 | 2 | 3 }[];
  state: { inWorldTime?: string; location?: string; relation?: string; mood?: string; facts?: string[] };
  overlays: { loreEntryId?: string; title: string; summary: string; content: string; reason?: string }[];
}

export function buildPrompt(campaign: Campaign, character: Character, lore: LoreEntry[], msgs: Message[], existing: EpisodicMemory[]) {
  const transcript = msgs.filter((m) => m.role !== 'system').map((m) => `${m.role === 'user' ? '用户' : character.name}：${textOf(m)}`).join('\n');
  const dir = lore.map((e) => `- [${e.id}] ${e.title}：${e.summary}`).join('\n');
  const prior = existing.slice(-15).map((m) => `- ${m.when}：${m.text}`).join('\n');
  const s = campaign.state;
  return {
    system: `你是角色扮演对话的记忆整理员。读下面这段对话，提取值得长期记住的内容，输出 JSON。
规则：
- memories：只记发生了的事和透露的信息，不记寒暄。已经在"已有记忆"里的不要重复。
- state：只填确实变化了的字段，没变就不填。facts 是当前仍然成立的事实的完整列表（可基于旧列表增删）。
- overlays：只有当剧情明确改变了世界书里的设定或世界本身时才填，宁缺毋滥。
- 全部用中文。`,
    user: `# 角色\n${character.name}：${character.core.slice(0, 600)}\n\n# 当前状态\n时间：${s.inWorldTime ?? '未知'}；地点：${s.location ?? '未知'}；关系：${s.relations[character.id] ?? '未知'}；情绪：${s.mood[character.id] ?? '未知'}\n事实：\n${s.facts.map((f) => '- ' + f).join('\n') || '（无）'}\n\n# 世界书目录\n${dir || '（无）'}\n\n# 已有记忆（最近）\n${prior || '（无）'}\n\n# 需要整理的对话\n${transcript}`,
  };
}

export async function applyOutput(campaign: Campaign, character: Character, lore: LoreEntry[], out: ConsolidateOutput, sourceIds: string[]) {
  const now = Date.now();
  const mems: EpisodicMemory[] = (out.memories ?? []).filter((m) => m.text?.trim()).map((m) => ({
    id: ulid(), campaignId: campaign.id, characterId: character.id, when: m.when ?? '', text: m.text.trim(),
    importance: ([1, 2, 3].includes(m.importance) ? m.importance : 2) as 1 | 2 | 3, sourceMessageIds: sourceIds, createdAt: now,
  }));
  if (mems.length) await db().memories.bulkAdd(mems);

  const st = out.state ?? {};
  const state = { ...campaign.state, relations: { ...campaign.state.relations }, mood: { ...campaign.state.mood } };
  if (st.inWorldTime) state.inWorldTime = st.inWorldTime;
  if (st.location) state.location = st.location;
  if (st.relation) state.relations[character.id] = st.relation;
  if (st.mood) state.mood[character.id] = st.mood;
  if (Array.isArray(st.facts) && st.facts.length) state.facts = st.facts.slice(0, 20);

  const overlays: LoreOverlay[] = (out.overlays ?? []).filter((o) => o.title && o.content).map((o) => ({
    id: ulid(), campaignId: campaign.id, loreEntryId: o.loreEntryId && lore.some((e) => e.id === o.loreEntryId) ? o.loreEntryId : undefined,
    title: o.title, summary: o.summary ?? '', content: o.content, reason: o.reason ?? '', createdAt: now, pending: true,
  }));
  if (overlays.length) await db().overlays.bulkAdd(overlays);
  return { mems, state, overlays };
}

/** 对一个会话做一次合并：处理 consolidatedUpTo 之后的消息。 */
export async function consolidate(conversationId: string, opts: { force?: boolean } = {}): Promise<boolean> {
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

  const lore = await db().lore.where('worldId').equals(campaign.worldId).filter((e) => e.enabled && e.kind !== 'style' && (e.scope === 'world' || !e.characterIds?.length || e.characterIds.includes(character.id))).toArray();
  const existing = await db().memories.where('campaignId').equals(campaign.id).sortBy('createdAt');
  const prompt0 = buildPrompt(campaign, character, lore, msgs, existing);
  const userName = await db().getKV('kernel.userName', '我');
  const prompt = { system: prompt0.system, user: expandMacros(prompt0.user, { user: userName, char: character.name }) };
  const r = await llm.chat({
    model: CONSOLIDATE_MODEL, effort: 'low', maxTokens: 4000, purpose: 'consolidate', conversationId,
    system: [{ type: 'text', text: prompt.system }], messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
    jsonSchema: SCHEMA,
  });
  let out: ConsolidateOutput;
  try { out = JSON.parse(r.text) as ConsolidateOutput; } catch { return false; }
  const { mems, state, overlays } = await applyOutput(campaign, character, lore, out, msgs.map((m) => m.id));
  await db().campaigns.update(campaign.id, { state, consolidatedUpTo: msgs[msgs.length - 1]!.ts });
  bus.emit('memory.consolidated', { campaignId: campaign.id, memories: mems.length, overlays: overlays.length });
  if (overlays.length) bus.emit('notify', { title: `${character.name} 的世界有 ${overlays.length} 处变化待确认`, body: overlays[0]!.title, pluginId: 'lore', screen: 'overlays' });
  return true;
}

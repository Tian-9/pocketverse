import { db } from '../storage/db';
import type { Campaign, CampaignClock, CampaignState, Message } from '../storage/db';
import { retractSource } from '../memory/state';
import { unconsolidate } from '../memory/consolidate';
import { wakes } from '../catchup/wake';
import { registry } from '../registry/registry.svelte';
import type { MessageCard } from '../api/types';
import { bus } from '../bus/bus';
import { log } from '../log/log';
import { isContext } from '../context/append';

/**
 * 撤回（ARCHITECTURE 5.12）：每样有副作用的写入都记「是谁带来的」，删消息和重新生成按它统一撤回。
 * 来源：你发的消息是它自己的 id；他的一轮回复是 turnId（每个气泡的 meta.turn）；整理是批次 id（这批最后一条消息的 id）。
 */

/** 地点、关系、情绪、时钟是覆盖写，不是事件：一轮结束时变了就记一份之前 / 之后，只留最近一轮 */
export interface TurnUndo {
  turn: string;
  before: { state: CampaignState; clock?: CampaignClock };
  after: { state: CampaignState; clock?: CampaignClock };
}
const undoKey = (campaignId: string) => `kernel.undo.${campaignId}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 一轮结束时调：和这一轮开始时比，变了才记 */
export async function rememberTurn(campaignId: string, turn: string, before: TurnUndo['before']): Promise<void> {
  const cp = await db().campaigns.get(campaignId);
  if (!cp) return;
  const after = { state: cp.state, clock: cp.clock };
  if (same(before.state, after.state) && same(before.clock, after.clock)) return;
  await db().setKV<TurnUndo>(undoKey(campaignId), { turn, before, after });
}

/** 撤回这些来源写的东西：先内核自己的（硬事实、世界覆盖、稍后联系、最近一轮的地点情绪时钟），再挨个等插件撤完 */
export async function retract(campaignId: string, conversationId: string, sources: string[], cards: MessageCard[] = []): Promise<void> {
  const S = new Set(sources.filter(Boolean));
  if (!S.size && !cards.length) return;
  for (const s of S) await retractSource(campaignId, s);
  const ovs = await db().overlays.where('campaignId').equals(campaignId).filter((o) => !!o.sourceId && S.has(o.sourceId)).primaryKeys();
  if (ovs.length) { await db().overlays.bulkDelete(ovs); bus.emit('memory.written', { kind: 'overlay', id: campaignId }); }
  const w = await wakes.get(campaignId);
  if (w?.sourceId && S.has(w.sourceId)) await wakes.clear(campaignId);
  const u = await db().getKV<TurnUndo | null>(undoKey(campaignId), null);
  if (u && S.has(u.turn)) {
    const cp = await db().campaigns.get(campaignId);
    if (cp) {
      // 哪样还是这一轮留下的样子就退回去；整理或你手改过的不动
      const patch: Partial<Campaign> = {};
      if (same(cp.state, u.after.state)) patch.state = u.before.state;
      if (same(cp.clock, u.after.clock)) patch.clock = u.before.clock;
      if (Object.keys(patch).length) { await db().campaigns.update(campaignId, patch); bus.emit('memory.written', { kind: 'state', id: campaignId }); }
    }
    await db().kv.delete(undoKey(campaignId));
  }
  for (const p of registry.plugins) {
    if (!p.retract || !registry.isEnabled(p.id)) continue;
    try { await p.retract({ campaignId, conversationId, sources: [...S], cards: cards.filter((c) => c.pluginId === p.id) }); }
    catch (e) { log.warn('retract', `${p.id} 撤回出错：${e instanceof Error ? e.message : String(e)}`, { campaignId }); }
  }
}

/**
 * 删消息，连它们带来的东西一起撤回。
 * 每条消息自己的 id 都算来源（你发的东西挂在它上面；老整理的硬事实也挂在那批最后一条上）；
 * 一轮回复的效果挂在整轮上，这一轮的消息全删光了才撤；已经整理过的，撤回那一批等重整。
 */
export async function removeMessages(ms: Message[]): Promise<void> {
  if (!ms.length) return;
  const conversationId = ms[0]!.conversationId;
  await db().messages.bulkDelete(ms.map((m) => m.id));
  const conv = await db().conversations.get(conversationId);
  if (!conv) return;
  const sources = new Set(ms.map((m) => m.id));
  const turns = new Set(ms.map((m) => m.meta?.turn).filter((t): t is string => typeof t === 'string'));
  if (turns.size) {
    const left = new Set((await db().messages.where('conversationId').equals(conversationId).toArray()).map((m) => m.meta?.turn));
    for (const t of turns) if (!left.has(t)) sources.add(t);
  }
  const cards = ms.flatMap((m) => (Array.isArray(m.meta?.cards) ? (m.meta.cards as MessageCard[]) : []));
  await retract(conv.campaignId, conversationId, [...sources], cards);
  await unconsolidate(conv.campaignId, ms);
  log.info('retract', `删了 ${ms.length} 条消息，撤回 ${sources.size} 个来源`, { conversationId });
}

/** 最后一次回复：最后一条你说的话之后的所有消息（回复的几个气泡、工具旁白、出错提示、他主动发的），隐藏的追加段不算 */
export function lastReply(msgs: Message[]): Message[] {
  let i = msgs.length;
  while (i > 0 && msgs[i - 1]!.role !== 'user') i--;
  return msgs.slice(i).filter((m) => !isContext(m));
}

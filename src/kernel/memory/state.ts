import { EventLog } from 'annals';
import { DexieEventStore } from 'annals/dexie';
import { diffPatches, renderStateLines, stateView, type StatePatch, type StateSetEvent } from 'annals/state';
import { db } from '../storage/db';
import type { Table } from 'dexie';
import type { EventRow } from 'annals/dexie';
import { bus } from '../bus/bus';
import { log } from '../log/log';

/** 状态块最多保留多少条（按最近写入淘汰，不按剧情天数：一句"三个月后"不能把状态清空） */
export const STATE_LINES = 20;

/**
 * 存档状态的事件通道（annals）。模型只给 {entity, attr, value}，旧值由代码从视图取，没变的丢掉；
 * 每条事件带 source（整理：那批最后一条消息 id；聊天里 state_update：这一轮的 turnId；手改：manual），
 * 删消息、重新生成时按 source 撤回，视图自动退回。
 */
function store(campaignId: string) {
  return new DexieEventStore<StateSetEvent>(db().events as unknown as Table<EventRow<StateSetEvent>, string>, campaignId);
}

export async function loadState(campaignId: string): Promise<StateSetEvent[]> {
  return store(campaignId).load();
}

/** 注入用的状态行，最近变化的在最后 */
export async function stateLines(campaignId: string, limit = STATE_LINES): Promise<string[]> {
  return renderStateLines(stateView(await loadState(campaignId)), { limit });
}

export async function applyPatches(campaignId: string, patches: StatePatch[], opts: { source: string; at: number }): Promise<StateSetEvent[]> {
  if (!patches.length) return [];
  const log_ = new EventLog<StateSetEvent>();
  log_.load(await loadState(campaignId));
  const changed = diffPatches(stateView(log_.all()), patches);
  if (!changed.length) return [];
  const added = changed.map((p) => log_.append({ at: opts.at, type: 'state.set', source: opts.source, payload: p }));
  await store(campaignId).append(added);
  bus.emit('memory.written', { kind: 'state', id: campaignId });
  log.info('state', `记下 ${added.length} 条状态：${added.map((e) => `${e.payload.entity}·${e.payload.attr}`).join('、')}`, { campaignId, source: opts.source });
  return added;
}

/** 撤回某个来源产生的全部状态事件（删消息、重新生成）。返回撤回条数 */
export async function retractSource(campaignId: string, source: string): Promise<number> {
  const gone = await store(campaignId).removeBySource(source);
  if (gone.length) {
    bus.emit('memory.written', { kind: 'state', id: campaignId });
    log.info('state', `撤回 ${gone.length} 条状态`, { campaignId, source });
  }
  return gone.length;
}

/** 删存档时连事件一起删 */
export async function clearState(campaignId: string): Promise<void> {
  await store(campaignId).clear();
}

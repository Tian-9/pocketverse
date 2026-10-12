import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import { applyPatches, clearState, loadState, retractSource, stateLines } from './state';
import { dataView } from '../data/view';

beforeAll(() => { openDB([]); });

describe('state events', () => {
  it('acceptance #2 + #4: patches fold to the latest value, no-ops are dropped, retract rolls back by source', async () => {
    const cp = 'st1';
    expect(await applyPatches(cp, [{ entity: '债务#红包', attr: '欠款', value: '他 欠 用户 50 元' }], { source: 'm1', at: 1 })).toHaveLength(1);
    // 同值不写
    expect(await applyPatches(cp, [{ entity: '债务#红包', attr: '欠款', value: '他 欠 用户 50 元' }], { source: 'm2', at: 2 })).toHaveLength(0);
    await applyPatches(cp, [{ entity: '债务#红包', attr: '欠款', value: '他 欠 用户 49.5 元' }, { entity: '猫', attr: '归属', value: '未明确（用户捡到，他没答应养）' }], { source: 'turn-9', at: 3 });
    expect(await stateLines(cp)).toEqual(['债务#红包 · 欠款：他 欠 用户 49.5 元', '猫 · 归属：未明确（用户捡到，他没答应养）']);
    // 撤回退款那一轮：方向和数额退回
    expect(await retractSource(cp, 'turn-9')).toBe(2);
    expect(await stateLines(cp)).toEqual(['债务#红包 · 欠款：他 欠 用户 50 元']);
    expect(await retractSource(cp, 'turn-9')).toBe(0);
    // seq 不撞号
    const added = await applyPatches(cp, [{ entity: '猫', attr: '位置', value: '客栈B' }], { source: 'm3', at: 4 });
    expect(added[0]!.seq).toBeGreaterThan((await loadState(cp)).filter((e) => e.source === 'm1')[0]!.seq);
  });

  it('scopes by campaign and clears with the campaign', async () => {
    await applyPatches('st2', [{ entity: 'a', attr: 'b', value: 'c' }], { source: 's', at: 1 });
    await applyPatches('st3', [{ entity: 'a', attr: 'b', value: 'd' }], { source: 's', at: 1 });
    expect(await stateLines('st2')).toEqual(['a · b：c']);
    await clearState('st2');
    expect(await stateLines('st2')).toEqual([]);
    expect(await stateLines('st3')).toEqual(['a · b：d']);
  });

  it('campaign view exposes state lines as facts, ahead of legacy facts', async () => {
    await db().worlds.add({ id: 'w-st', name: 'w', summary: '', createdAt: 0, updatedAt: 0 });
    await db().characters.add({ id: 'c-st', name: '林', core: '', full: '' });
    await db().campaigns.add({ id: 'cp-st', worldId: 'w-st', characterIds: ['c-st'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: ['老事实'] } });
    await applyPatches('cp-st', [{ entity: '猫', attr: '位置', value: '客栈B' }], { source: 's', at: 1 });
    const v = await dataView.campaign('cp-st');
    expect(v?.state.facts).toEqual(['猫 · 位置：客栈B', '老事实']);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext, CatchupContext } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin, { diaryApi } from './index';

const H = 3600_000, D = 24 * H;
// 他在东京：3 月 13 日 23:00 聊了一句，14 日 01:00 又聊了一句（UTC 还是 13 日）
const night = Date.UTC(2027, 2, 13, 14, 0), smallHours = Date.UTC(2027, 2, 13, 16, 0);
const events = [
  { owner: 'ch1', start: Date.UTC(2027, 2, 13, 10, 30), title: '晚饭', place: '食堂', status: 'done' as const, note: '吃撑了' },
  { owner: 'user', start: Date.UTC(2027, 2, 13, 11, 0), title: '对方的事' },
  { owner: 'ch1', start: Date.UTC(2027, 2, 14, 1, 0), title: '次日早课' },
];

beforeAll(async () => {
  openDB([plugin]);
  await db().characters.add({ id: 'ch1', name: '阿一', core: '', full: '', timeZone: 'Asia/Tokyo' });
  await db().campaigns.add({ id: 'cp1', worldId: 'w1', characterIds: ['ch1'], name: '东京', createdAt: 1, lastPlayedAt: 1, state: { relations: {}, mood: {}, facts: [] } });
  await db().conversations.add({ id: 'cv', campaignId: 'cp1', kind: 'direct', participantIds: ['ch1'], pluginId: 'chat' });
  await db().messages.bulkAdd([
    { id: 'm1', conversationId: 'cv', role: 'user', content: [{ type: 'text', text: '晚安' }], ts: 1, storyTs: night },
    { id: 'm2', conversationId: 'cv', role: 'user', content: [{ type: 'text', text: '怎么还没睡' }], ts: 2, storyTs: smallHours },
  ]);
  const ctx = {
    id: 'diary',
    emit() {}, navigate() {}, back() {}, notify() {},
    settings: { async get(_k: string, f: unknown) { return f; }, async set() {} },
    table: (name: string) => db().table(pluginTable('diary', name)),
    llm: { configured: false, async chat() { return { text: '' }; } },
    service: (name: string) => (name === 'calendar' ? { async between(_c: string, from: number, to: number) { return events.filter((e) => e.start >= from && e.start < to); } } : undefined),
    data: { async character(id: string) { return id === 'ch1' ? { id, name: '阿一', core: '', timeZone: 'Asia/Tokyo' } : undefined; } },
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
});

describe('diary material', () => {
  it('takes that day in his zone and lists his calendar for it with what he did', async () => {
    const m = (await diaryApi.material('cp1', 'ch1', '2027-03-13'))!;
    expect(m.talked).toBe(true);
    expect(m.text).toContain('对方：晚安');
    expect(m.text).not.toContain('怎么还没睡'); // 东京已是 14 日
    expect(m.text).toContain('那天日历上的安排');
    expect(m.text).toContain('- 19:30 晚饭（食堂）（做了：吃撑了）');
    expect(m.text).not.toContain('对方的事');
    expect(m.text).not.toContain('次日早课');
  });
  it('catchup writes yesterday by his zone', async () => {
    const c = plugin.catchup![0]!;
    const to = Date.UTC(2027, 2, 14, 3, 0); // 东京 14 日 12:00
    const cctx: CatchupContext = { campaignId: 'cp1', characterId: 'ch1', characterName: '阿一', elapsedMs: 8 * H, from: to - 8 * H, to, now: to, days: 0, tier: 'h6', elapsedText: '大约 8 小时' };
    const item = (await c.collect(cctx))!;
    expect(item.prompt).toContain('补写昨天（2027-03-13）的日记');
    expect(item.prompt).toContain('19:30 晚饭');
    await item.apply({ text: '今天吃撑了。' }, cctx);
    expect((await diaryApi.forDate('cp1', '2027-03-13'))?.text).toBe('今天吃撑了。');
    expect(await c.collect(cctx)).toBeNull();
    // 再过一天：补 14 日的，凌晨那句和早课都算 14 日的
    const next = (await c.collect({ ...cctx, to: to + D, now: to + D, from: to + D - 8 * H }))!;
    expect(next.prompt).toContain('补写昨天（2027-03-14）');
    expect(next.prompt).toContain('对方：怎么还没睡');
    expect(next.prompt).toContain('- 10:00 次日早课');
  });
});

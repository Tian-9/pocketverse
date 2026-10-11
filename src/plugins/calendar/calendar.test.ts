import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext, CampaignView, PromptContext, CatchupContext } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import { clock } from '$kernel/api';
import plugin, { calendarApi, volatileLine, parseWhen, HORIZON_DAYS, dayLabel } from './index';
import { planUser, parsePlan } from './plan';

/** 设备本地时区的「那天几点」（测试里的局没设时区） */
const tsOf = (date: string, time: string) => clock.zoned(date, time);

const H = 3600_000, D = 24 * H;
// 剧情「现在」：2027-03-10 10:00（设备本地时区），和真实时间无关
const now = new Date(2027, 2, 10, 10, 0).getTime();
const campaign: CampaignView = {
  id: 'cp1', name: '雨城', worldId: 'w1', worldName: '雨城', characterId: 'ch1', characterName: '阿一', lastPlayedAt: 1, now, aligned: false,
  state: { location: '图书馆', relations: {}, mood: { ch1: '困' }, facts: ['下周考试'] },
};
/** 同一张卡在东京的局：他那边的几点按 Asia/Tokyo 算 */
const tokyo: CampaignView = { ...campaign, id: 'cp2', timeZone: 'Asia/Tokyo' };
let answer = '';
let lastUser = '';
let calls = 0;
const kv = new Map<string, unknown>();

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'calendar',
    emit() {}, navigate() {}, back() {}, notify() {},
    settings: { async get(k: string, f: unknown) { return kv.has(k) ? kv.get(k) : f; }, async set(k: string, v: unknown) { kv.set(k, v); } },
    table: (name: string) => db().table(pluginTable('calendar', name)),
    llm: { configured: true, async chat(req: { user: string }) { calls++; lastUser = req.user; return { text: answer }; } },
    data: {
      async currentCampaigns() { return [campaign]; },
      async campaign(id: string) { return id === campaign.id ? campaign : id === tokyo.id ? tokyo : undefined; },
      async world() { return { id: 'w1', name: '雨城', summary: '总在下雨' }; },
      async character(id: string) { return id === 'ch1' ? { id, name: '阿一', core: '图书馆管理员' } : undefined; },
      async characters() { return []; },
      async memories() { return [{ id: 'm', when: '', text: '邮差来过', importance: 3 as const, createdAt: 1 }]; },
      async loreDirectory() { return '- [a] 图书馆：很大'; },
    },
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
});

describe('plan (pure)', () => {
  it('builds the prompt from the material and keeps only valid items on allowed days', () => {
    const u = planUser({ characterName: '阿一', core: '图书馆管理员', worldName: '雨城', worldSummary: '总在下雨', loreDirectory: '- [a] 图书馆', location: '图书馆', mood: '困', happenings: ['下周考试'], days: ['2027-03-11 周四'], existing: ['2027-03-11 19:00 吃饭（对方的）'] });
    for (const s of ['阿一：图书馆管理员', '雨城：总在下雨', '[a] 图书馆', '地点：图书馆', '下周考试', '2027-03-11 周四', '吃饭（对方的）']) expect(u).toContain(s);
    const items = parsePlan(JSON.stringify({ items: [
      { date: '2027-03-11', start: '9:00', end: '10:00', title: '晨会', place: '' },
      { date: '2027-03-11', start: '14:00', end: '', title: '还书', place: '图书馆' },
      { date: '2027-03-12', start: '09:00', end: '', title: '不在要排的日子里', place: '' },
      { date: '2027-03-11', start: '25:00', end: '', title: '时间不对', place: '' },
      { date: '2027-03-11', start: '08:00', end: '', title: '', place: '' },
    ] }), ['2027-03-11']);
    expect(items).toEqual([{ date: '2027-03-11', start: '9:00', end: '10:00', title: '晨会' }, { date: '2027-03-11', start: '14:00', title: '还书', place: '图书馆' }]);
    expect(parsePlan('nope', ['2027-03-11'])).toEqual([]);
    expect(new Date(tsOf('2027-03-11', '14:30')).getHours()).toBe(14);
    expect(dayLabel('2027-03-11')).toBe('2027-03-11 周四');
  });
  it('parses tool datetimes', () => {
    expect(parseWhen('2027-03-12 19:30')).toBe(tsOf('2027-03-12', '19:30'));
    expect(parseWhen('2027-03-12T19:30')).toBe(tsOf('2027-03-12', '19:30'));
    expect(parseWhen('2027-03-12')).toBe(tsOf('2027-03-12', '09:00'));
    expect(parseWhen('明天晚上')).toBeNull();
    expect(parseWhen('')).toBeNull();
  });
});

describe('planWeek', () => {
  it('asks for the next uncovered days from story-today, stores events on them, and ensure() stops once the horizon is covered', async () => {
    answer = JSON.stringify({ items: [
      { date: '2027-03-10', start: '14:00', end: '15:00', title: '还书', place: '图书馆' },
      { date: '2027-03-11', start: '09:00', end: '', title: '晨会', place: '' },
      { date: '2027-03-12', start: '09:00', end: '', title: '晨会', place: '' },
      { date: '2027-03-13', start: '10:00', end: '', title: '周末睡懒觉', place: '' },
    ] });
    const rows = (await calendarApi.planWeek('cp1', 'ch1', now))!;
    expect(rows).toHaveLength(4);
    expect(lastUser).toContain('2027-03-10 周三');
    expect(lastUser).toContain('2027-03-16 周二');
    expect(lastUser).not.toContain('2027-03-17');
    expect(rows[0]).toMatchObject({ owner: 'ch1', title: '还书', place: '图书馆', source: 'plan', status: 'planned', start: tsOf('2027-03-10', '14:00'), end: tsOf('2027-03-10', '15:00') });
    expect(rows[1]!.end).toBeUndefined();
    expect(await calendarApi.horizon('cp1', 'ch1', now)).toBe(4);
    // 够 3 天了，ensure 不再排
    const before = calls;
    calendarApi.ensure('cp1', 'ch1', now);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(before);
    expect(HORIZON_DAYS).toBe(3);
    // 再排：跳过已经排过的四天，从 3/14 起要七天
    answer = JSON.stringify({ items: [] });
    await calendarApi.planWeek('cp1', 'ch1', now);
    expect(lastUser).toContain('2027-03-14 周日');
    expect(lastUser).toContain('2027-03-20 周六');
    expect(lastUser).not.toContain('2027-03-11 周四');
    expect(lastUser).not.toContain('已经有的安排');
  });
});

describe('volatile line, tools, service', () => {
  const pctx: PromptContext = { campaignId: 'cp1', conversationId: 'cv', characterIds: ['ch1'], now };
  const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;
  it('tells him today, what he is doing now and what is next', async () => {
    const line = await volatileLine('cp1', 'ch1', now + 4 * H + 10 * 60_000); // 14:10，正在还书
    expect(line).toContain('你今天的安排：14:00–15:00 还书（图书馆）');
    expect(line).toContain('现在正在：还书');
    expect(line).toContain('接下来：3/11 09:00 晨会');
    expect(await volatileLine('cp1', 'ch1', now + 30 * D)).toBe('');
    expect(await plugin.promptContributors![0]!.volatile!(pctx)).toContain('接下来：14:00–15:00 还书');
  });
  it('calendar_add writes his event, together also writes yours; calendar_read lists by day', async () => {
    expect(await tool('calendar_add').handler({ title: '看电影', start: '2027-03-13 19:30', end: '2027-03-13 21:30', place: '影院', together: true }, pctx)).toContain('看电影（对方的日历里也有了）');
    expect(await tool('calendar_add').handler({ title: '', start: '2027-03-13 19:30' }, pctx)).toContain('title 不能为空');
    expect(await tool('calendar_add').handler({ title: 'x', start: '周六晚上' }, pctx)).toContain('start 格式不对');
    const day = await calendarApi.onDay('cp1', '2027-03-13');
    expect(day.map((e) => [e.owner, e.title, e.together, e.source])).toEqual([['ch1', '周末睡懒觉', undefined, 'plan'], ['ch1', '看电影', true, 'chat'], ['user', '看电影', true, 'chat']]);
    const r = (await tool('calendar_read').handler({ days: 4 }, pctx)) as string;
    expect(r).toContain('2027-03-13 周六');
    expect(r).toContain('19:30–21:30 看电影（影院），和对方一起');
    expect(r).not.toContain('对方的');
    expect(r).not.toContain('2027-03-14');
    const svc = (plugin.services as { calendar: { next(c: string, n: number): Promise<{ title: string } | undefined> } }).calendar;
    expect((await svc.next('cp1', tsOf('2027-03-13', '12:00')))?.title).toBe('看电影');
  });
  it('catchup marks passed events done or skipped with a note', async () => {
    const c = plugin.catchup![0]!;
    const cctx: CatchupContext = { campaignId: 'cp1', characterId: 'ch1', characterName: '阿一', elapsedMs: 2 * D, from: now, to: now + 2 * D, now: now + 2 * D, days: 2, tier: 'days', elapsedText: '2 天', skipped: true };
    const item = (await c.collect(cctx))!;
    expect(item.prompt).toContain('1. 3/10 14:00 还书（图书馆）');
    expect(item.prompt).toContain('3. 3/12 09:00 晨会');
    await item.apply({ items: [{ n: 1, done: true, note: '顺便借了两本' }, { n: 2, done: false, note: '' }] }, cctx);
    const done = await calendarApi.between('cp1', now, now + 2 * D);
    expect(done.map((e) => [e.title, e.status, e.note])).toEqual([['还书', 'done', '顺便借了两本'], ['晨会', 'skipped', undefined], ['晨会', 'done', undefined]]);
    expect(await c.collect(cctx)).toBeNull();
  });
  it('a character in another zone: his day and HH:MM follow that zone, not the device', async () => {
    const p2: PromptContext = { ...pctx, campaignId: 'cp2' };
    await tool('calendar_add').handler({ title: '晚饭', start: '2027-03-13 19:30' }, p2);
    const e = (await calendarApi.between('cp2', 0, Infinity))[0]!;
    expect(e.start).toBe(Date.UTC(2027, 2, 13, 10, 30)); // 东京 19:30 = UTC 10:30
    expect((await calendarApi.today('cp2', Date.UTC(2027, 2, 13, 14, 0))).map((x) => x.title)).toEqual(['晚饭']); // 东京 13 日 23:00
    expect(await calendarApi.today('cp2', Date.UTC(2027, 2, 13, 16, 0))).toEqual([]); // 东京已是 14 日
    expect(await volatileLine('cp2', 'ch1', Date.UTC(2027, 2, 13, 9, 0))).toContain('你今天的安排：19:30 晚饭');
    expect(await tool('calendar_read').handler({ days: 1 }, { ...p2, now: Date.UTC(2027, 2, 13, 9, 0) })).toContain('2027-03-13 周六\n  19:30 晚饭');
  });
});

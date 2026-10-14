import { definePlugin, icons, gradients, clock } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext } from '$kernel/api';
import { ulid } from 'ulid';
import Calendar from './Calendar.svelte';
import CalendarSection from './CalendarSection.svelte';
import { PLAN_SYSTEM, planUser, planSchema, parsePlan, shapePlan } from './plan';

/**
 * 日历：挂在存档时钟上的事件。他的安排由便宜模型按周排（像商店进货），聊天里约的事记进来，你也能手填。
 * 设计见 designs/clock-and-calendar.md 第 4 节。真实局和剧情局同一套代码：「现在」一律问时钟。
 * 「几点」「哪一天」按他的时区（角色卡 timeZone，没设就是设备时区）：日期键、日界、HH:MM 的显示和解析都套它。
 */
export interface CalendarEvent {
  id: string; campaignId: string;
  /** 谁的安排：角色 id，或 'user'（你自己的，他能看见） */
  owner: string;
  /** 剧情时钟上的时刻 */
  start: number; end?: number;
  title: string; note?: string; place?: string;
  /** 和对方一起（约好的事，两个人的日历各一条） */
  together?: boolean;
  /** plan：模型排的；chat：聊天里约的；manual：你手填的 */
  source: 'plan' | 'chat' | 'manual';
  /** 过了时间之后由补发标记：做了 / 没做 */
  status?: 'planned' | 'done' | 'skipped';
}

const H = 3600_000, D = 24 * H;
/** 往后不足这么多天「排过」就再排一周（排过但空着的日子也算，工作日大多就是空的） */
export const HORIZON_DAYS = 3;
/** 排程规矩的版本：变了就把未来还没过的模型排程清掉重排一次（2 = 工作日不排作息、周末一两件） */
export const PLAN_POLICY = 2;
export const PLAN_DAYS = 7;

let ctx: PluginContext;
const planning = new Set<string>();
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const dayLabel = (key: string) => `${key} ${WEEKDAY[new Date(key + 'T00:00').getDay()]}`;
/** 某一天（YYYY-MM-DD）在他的时区里的 [零点, 次日零点) */
export function dayRange(key: string, tz?: string): [number, number] {
  const s = clock.zoned(key, '00:00', tz);
  return [s, clock.zoned(clock.dateKey(s + 36 * H, tz), '00:00', tz)];
}

export const calendarApi = {
  ctx: () => ctx,
  events: () => ctx.table<CalendarEvent>('events'),
  lastCampaign: () => ctx.settings.get<string | null>('campaign', null),
  setLastCampaign: (id: string) => ctx.settings.set('campaign', id),
  isPlanning: (campaignId: string) => planning.has(campaignId),
  /** 这局的他的时区 */
  async tz(campaignId: string): Promise<string | undefined> { return (await ctx.data.campaign(campaignId))?.timeZone; },

  /** [from, to) 之间的，按开始时间排 */
  async between(campaignId: string, from: number, to: number): Promise<CalendarEvent[]> {
    // 同一时刻：他的在前，再按 id，顺序稳定（约好的事两人各一条，start 一样）
    return (await this.events().where('campaignId').equals(campaignId).filter((e) => e.start >= from && e.start < to).toArray())
      .sort((a, b) => a.start - b.start || Number(a.owner === 'user') - Number(b.owner === 'user') || a.id.localeCompare(b.id));
  },
  async onDay(campaignId: string, key: string) { const [s, e] = dayRange(key, await this.tz(campaignId)); return this.between(campaignId, s, e); },
  async today(campaignId: string, now: number) { return this.onDay(campaignId, clock.dateKey(now, await this.tz(campaignId))); },
  /** 下一件还没开始的 */
  async next(campaignId: string, now: number): Promise<CalendarEvent | undefined> {
    return (await this.between(campaignId, now, now + 365 * D))[0];
  },
  async add(e: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const row: CalendarEvent = { ...e, id: ulid() };
    await this.events().add(row);
    return row;
  },
  /** 聊天里约的事：和对方一起时你的日历也一条 */
  async addTogether(campaignId: string, characterId: string, e: Pick<CalendarEvent, 'start' | 'end' | 'title' | 'place' | 'note' | 'source'>, together: boolean): Promise<CalendarEvent> {
    const mine = await this.add({ campaignId, owner: characterId, ...e, status: 'planned', ...(together ? { together: true } : {}) });
    if (together) await this.add({ campaignId, owner: 'user', ...e, together: true });
    return mine;
  },
  async update(id: string, patch: Partial<CalendarEvent>) { await this.events().update(id, patch); },
  async remove(id: string) { await this.events().delete(id); },

  /** 排过的日子（日期键）。工作日大多排出来是空的，不能靠「有没有安排」判断排没排过，不然每轮都重排 */
  async plannedDays(campaignId: string): Promise<Set<string>> {
    return new Set(await ctx.settings.get<string[]>(`planned.${campaignId}`, []));
  },
  async markPlanned(campaignId: string, days: string[]) {
    const all = [...new Set([...(await this.plannedDays(campaignId)), ...days])].sort().slice(-120);
    await ctx.settings.set(`planned.${campaignId}`, all);
  },
  /**
   * 排程规矩改了（PLAN_POLICY）：把今天起还没过的模型排程清掉、排过的日子忘掉，下一次 ensure 按新规矩重排。
   * 聊天里约的、你手填的、已经过去的都不动。
   */
  async migratePolicy(campaignId: string, characterId: string, now: number) {
    if ((await ctx.settings.get<number>(`policy.${campaignId}`, 1)) >= PLAN_POLICY) return;
    const tz = await this.tz(campaignId);
    const [start] = dayRange(clock.dateKey(now, tz), tz);
    const stale = (await this.between(campaignId, start, Infinity)).filter((e) => e.owner === characterId && e.source === 'plan' && (e.status ?? 'planned') === 'planned');
    if (stale.length) await this.events().bulkDelete(stale.map((e) => e.id));
    const keep = [...(await this.plannedDays(campaignId))].filter((k) => k < clock.dateKey(now, tz));
    await ctx.settings.set(`planned.${campaignId}`, keep);
    await ctx.settings.set(`policy.${campaignId}`, PLAN_POLICY);
  },
  /** 从今天起往后，排过的日子有几天（有他的安排的日子也算，兼容老数据） */
  async horizon(campaignId: string, characterId: string, now: number): Promise<number> {
    const tz = await this.tz(campaignId);
    const today = clock.dateKey(now, tz);
    const [start] = dayRange(today, tz);
    const days = new Set([...(await this.plannedDays(campaignId))].filter((k) => k >= today));
    for (const e of await this.between(campaignId, start, start + 60 * D)) if (e.owner === characterId && e.source === 'plan') days.add(clock.dateKey(e.start, tz));
    return days.size;
  },
  /** 不足 HORIZON_DAYS 天就排一周；不等结果（给易变段用，不拖慢这一轮） */
  ensure(campaignId: string, characterId: string, now: number) {
    if (!ctx.llm.configured || planning.has(campaignId)) return;
    this.migratePolicy(campaignId, characterId, now)
      .then(() => this.horizon(campaignId, characterId, now))
      .then((n) => { if (n < HORIZON_DAYS) return this.planWeek(campaignId, characterId, now); }).catch(() => {});
  },

  /**
   * 排一周：从今天起找 PLAN_DAYS 个他还没有安排的日子，让便宜模型排。一局一次只跑一个；没配 API Key 返回 null。
   */
  async planWeek(campaignId: string, characterId: string, now: number): Promise<CalendarEvent[] | null> {
    if (!ctx.llm.configured || planning.has(campaignId)) return null;
    planning.add(campaignId);
    try {
      // 老规矩排的还没过的先清掉（只跑一次），再按新规矩排
      await this.migratePolicy(campaignId, characterId, now);
      const cp = await ctx.data.campaign(campaignId);
      const ch = await ctx.data.character(characterId);
      if (!cp || !ch) return null;
      const tz = ch.timeZone;
      const [start] = dayRange(clock.dateKey(now, tz), tz);
      const have = await this.between(campaignId, start, start + 60 * D);
      const covered = new Set([...(await this.plannedDays(campaignId)), ...have.filter((e) => e.owner === characterId && e.source === 'plan').map((e) => clock.dateKey(e.start, tz))]);
      const days: string[] = [];
      for (let i = 0; days.length < PLAN_DAYS && i < 60; i++) { const k = clock.dateKey(start + i * D + H, tz); if (!covered.has(k)) days.push(k); }
      const existing = have.filter((e) => days.includes(clock.dateKey(e.start, tz))).map((e) => `${clock.dateKey(e.start, tz)} ${clock.formatTime(e.start, tz)} ${e.title}${e.owner === 'user' ? '（对方的）' : ''}`);
      const [world, dir, mems] = await Promise.all([ctx.data.world(cp.worldId), ctx.data.loreDirectory(campaignId), ctx.data.memories(campaignId, { limit: 6, minImportance: 2 })]);
      const { text } = await ctx.llm.chat({
        system: PLAN_SYSTEM,
        user: planUser({
          characterName: ch.name, core: ch.core, worldName: world?.name ?? cp.worldName, worldSummary: world?.summary ?? '', loreDirectory: dir.slice(0, 3000),
          location: cp.state.location, mood: cp.state.mood[characterId], happenings: [...cp.state.facts, ...mems.map((m) => m.text)].slice(0, 10),
          days: days.map(dayLabel), existing,
        }),
        cheap: true, maxTokens: 2500, jsonSchema: planSchema(),
      });
      // 按规矩收一收（工作日去掉固定作息、每天封顶），这几天都记成排过，空着的也算
      const items = shapePlan(parsePlan(text, days));
      await this.markPlanned(campaignId, days.map((d) => d.slice(0, 10)));
      const at = (date: string, time: string) => clock.zoned(date, time, tz);
      const rows: CalendarEvent[] = items.map((it) => ({
        id: ulid(), campaignId, owner: characterId, start: at(it.date, it.start), ...(it.end && at(it.date, it.end) > at(it.date, it.start) ? { end: at(it.date, it.end) } : {}),
        title: it.title, ...(it.place ? { place: it.place } : {}), source: 'plan', status: 'planned',
      }));
      if (rows.length) await this.events().bulkAdd(rows);
      ctx.emit('calendar.planned', { campaignId, count: rows.length });
      return rows;
    } finally { planning.delete(campaignId); }
  },
};

const line = (e: CalendarEvent, tz?: string) => `${clock.formatTime(e.start, tz)}${e.end ? '–' + clock.formatTime(e.end, tz) : ''} ${e.title}${e.place ? '（' + e.place + '）' : ''}${e.together ? '，和对方一起' : ''}`;

/** 提前多久提一句「接下来」：再远的事不用每轮念叨 */
export const UPCOMING_WITHIN = 2 * D;

/**
 * 易变段：今天的安排、现在正在干什么、接下来一件。只给他自己的。
 * 日历只记特别的事，工作日大多是空的：今天没事、两天内也没事就整行不出现，作息让他按身份自己过。
 */
export async function volatileLine(campaignId: string, characterId: string, now: number): Promise<string> {
  const tz = await calendarApi.tz(campaignId);
  const today = (await calendarApi.today(campaignId, now)).filter((e) => e.owner === characterId);
  const current = today.find((e) => e.start <= now && now < (e.end ?? e.start + H));
  const next = today.find((e) => e.start > now) ?? (await calendarApi.next(campaignId, now));
  const upcoming = next && next.start - now <= UPCOMING_WITHIN ? next : undefined;
  if (!today.length && !upcoming) return '';
  const parts = today.length ? [`你今天的安排：${today.map((e) => line(e, tz)).join(' · ')}`] : [];
  if (current) parts.push(`现在正在：${current.title}`);
  if (upcoming) parts.push(`接下来：${clock.dateKey(upcoming.start, tz) === clock.dateKey(now, tz) ? '' : clock.formatShort(upcoming.start, tz).split(' ')[0] + ' '}${line(upcoming, tz)}`);
  return `（${parts.join('。')}。）`;
}

/** 补发 · 过去的安排：这段时间里排了的事，做了没做 */
async function collectPassed(c: CatchupContext) {
  const passed = (await calendarApi.between(c.campaignId, c.from, c.to)).filter((e) => e.owner === c.characterId && (e.status ?? 'planned') === 'planned').slice(0, 8);
  if (!passed.length) return null;
  const tz = await calendarApi.tz(c.campaignId);
  return {
    label: '日程',
    prompt: `这段时间你日历上排了这些事：\n${passed.map((e, i) => `${i + 1}. ${clock.formatShort(e.start, tz)} ${e.title}${e.place ? '（' + e.place + '）' : ''}`).join('\n')}\n按编号说每件做了没做（done），一句话说说怎么样（note，像给自己记的备注，可以空）。大多数照做了，偶尔鸽一件也正常。`,
    schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'done', 'note'], properties: { n: { type: 'integer' }, done: { type: 'boolean' }, note: { type: 'string' } } } } } },
    async apply(out: unknown) {
      const items = ((out as { items?: { n?: number; done?: boolean; note?: string }[] } | undefined)?.items ?? []);
      for (let i = 0; i < passed.length; i++) {
        const r = items.find((x) => x.n === i + 1);
        const note = String(r?.note ?? '').trim().slice(0, 120);
        await calendarApi.update(passed[i]!.id, { status: r?.done === false ? 'skipped' : 'done', ...(note ? { note } : {}) });
      }
    },
  };
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
/** 「2026-10-12 19:30」「2026-10-12T19:30」→ 他的时区里的那一刻；只给日期算 09:00；解析不了 null */
export function parseWhen(v: unknown, tz?: string): number | null {
  const s = str(v, 40).replace(' ', 'T');
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{1,2}:\d{2}))?$/.exec(s);
  if (!m) return null;
  const t = clock.zoned(m[1]!, m[2] ?? '09:00', tz);
  return Number.isFinite(t) ? t : null;
}

export default definePlugin({
  id: 'calendar',
  name: '日历',
  version: '0.1.0',
  description: '他的日程：按周自动排，聊天里约的事记进来，你也能手填。时间按这局的钟走，推进时间时他把过去的安排过完。',
  app: { screen: Calendar, icon: { paths: icons.calendar, background: gradients.red } },
  storage: { tables: { events: 'id, campaignId, owner, start' } },
  profileSections: [{ id: 'today', label: '他今天', component: CalendarSection }],
  services: { calendar: {
    today: (campaignId: string, now: number) => calendarApi.today(campaignId, now),
    between: (campaignId: string, from: number, to: number) => calendarApi.between(campaignId, from, to),
    next: (campaignId: string, now: number) => calendarApi.next(campaignId, now),
  } },
  promptContributors: [{
    id: 'today',
    async volatile(p: PromptContext) {
      const characterId = p.characterIds[0]!;
      calendarApi.ensure(p.campaignId, characterId, p.now);
      return volatileLine(p.campaignId, characterId, p.now);
    },
  }],
  tools: [
    {
      name: 'calendar_add',
      label: '记到日历',
      description: '把一件有具体时间的事记到自己的日历里：和对方约好的（together 填 true，对方的日历也会有），或自己的安排。start 写「YYYY-MM-DD HH:MM」（现在几点在最后一条消息里）。只记真的约定了的事，一轮最多一两件。',
      inputSchema: { type: 'object', properties: {
        title: { type: 'string', description: '短标题，像日历里的一行' }, start: { type: 'string', description: 'YYYY-MM-DD HH:MM' }, end: { type: 'string', description: 'YYYY-MM-DD HH:MM，可选' },
        place: { type: 'string' }, together: { type: 'boolean', description: '和对方一起的事' },
      }, required: ['title', 'start'] },
      async handler(input: unknown, p: PromptContext) {
        const o = input as { title?: unknown; start?: unknown; end?: unknown; place?: unknown; together?: unknown } | undefined;
        const tz = await calendarApi.tz(p.campaignId);
        const title = str(o?.title, 40), start = parseWhen(o?.start, tz), end = parseWhen(o?.end, tz), place = str(o?.place, 40);
        if (!title) return 'title 不能为空。';
        if (start === null) return 'start 格式不对，写「YYYY-MM-DD HH:MM」。';
        const e = await calendarApi.addTogether(p.campaignId, p.characterIds[0]!, { start, ...(end !== null && end > start ? { end } : {}), title, ...(place ? { place } : {}), source: 'chat' }, o?.together === true);
        return `记下了：${clock.format(e.start, tz)} ${e.title}${e.together ? '（对方的日历里也有了）' : ''}。`;
      },
    },
    {
      name: 'calendar_read',
      label: '翻日历',
      description: '看自己接下来几天的安排（默认 7 天），回答「周末有空吗」这类问题时用。days 是从今天起看几天。',
      inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 30 } } },
      async handler(input: unknown, p: PromptContext) {
        const days = Math.min(30, Math.max(1, Math.round(Number((input as { days?: unknown })?.days) || 7)));
        const tz = await calendarApi.tz(p.campaignId);
        const [start] = dayRange(clock.dateKey(p.now, tz), tz);
        const all = (await calendarApi.between(p.campaignId, start, start + days * D)).filter((e) => e.owner === p.characterIds[0]);
        if (!all.length) return '这几天日历上没有安排。';
        const byDay = new Map<string, CalendarEvent[]>();
        for (const e of all) { const k = clock.dateKey(e.start, tz); byDay.set(k, [...(byDay.get(k) ?? []), e]); }
        return [...byDay.entries()].map(([k, es]) => `${dayLabel(k)}\n${es.map((e) => '  ' + line(e, tz) + (e.status === 'done' ? '（已做）' : e.status === 'skipped' ? '（没去）' : '')).join('\n')}`).join('\n');
      },
    },
  ],
  catchup: [{ id: 'passed', tier: 'h6', collect: collectPassed }],
  setup(c) { ctx = c; },
});

import type { CampaignClock } from '../storage/db';

/**
 * 存档时钟：这一局「现在几点」。剧情时刻是普通的毫秒时间戳，显示时套角色的时区。
 * 没有时钟（undefined）＝和真实时间一样。走表：剧情时间随真实时间流逝；停表：只有推进才动。
 * 这里全是纯函数，返回新的时钟值，写库由调用方做。设计见 designs/clock-and-calendar.md。
 */
export const MAX_ADVANCE_MINUTES = 24 * 60;

export const clock = {
  now(c: CampaignClock | undefined, real = Date.now()): number {
    if (!c) return real;
    return c.running ? c.anchorStoryTs + (real - c.anchorRealTs) : c.anchorStoryTs;
  },
  /** 和真实时间对齐（走表、没跳过）：这种局的「现在」就是真的现在，真实天气之类只在这时给 */
  aligned(c: CampaignClock | undefined, real = Date.now()): boolean {
    return !c || (c.running && Math.abs(this.now(c, real) - real) < 60_000);
  },
  skipTo(c: CampaignClock | undefined, ts: number, real = Date.now()): CampaignClock {
    return { anchorStoryTs: ts, anchorRealTs: real, running: c?.running ?? true };
  },
  skipBy(c: CampaignClock | undefined, ms: number, real = Date.now()): CampaignClock {
    return this.skipTo(c, this.now(c, real) + ms, real);
  },
  setRunning(c: CampaignClock | undefined, running: boolean, real = Date.now()): CampaignClock {
    return { anchorStoryTs: this.now(c, real), anchorRealTs: real, running };
  },
  /** 「2026/10/11 09:30」 */
  format(ts: number, timeZone?: string): string {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', ...tz(timeZone) });
  },
  /** 「10/11 09:30」 */
  formatShort(ts: number, timeZone?: string): string {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', ...tz(timeZone) });
  },
  /** 「2026-10-11」，日记、日历按天分组用 */
  dateKey(ts: number, timeZone?: string): string {
    const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...tz(timeZone) }).formatToParts(new Date(ts));
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  },
  /** 「09:30」 */
  formatTime(ts: number, timeZone?: string): string {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', ...tz(timeZone) });
  },
  /**
   * 「2026-10-11」+「09:30」在某个时区里是哪一刻。不给时区就按设备本地；时区名不认识也按本地。
   * 日历、日记按「他那边的几点」算，用这个；别自己 new Date(y, m, d)。
   */
  zoned(dateKey: string, time: string, timeZone?: string): number {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    if (!tz(timeZone).timeZone) return new Date(y!, mo! - 1, d!, h ?? 0, mi ?? 0, 0, 0).getTime();
    const wall = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0);
    // 先假设墙上时间就是 UTC，再按那一刻的时差修正；夏令时切换日再修一次
    let ts = wall - offset(wall, timeZone!);
    const again = wall - offset(ts, timeZone!);
    if (again !== ts) ts = again;
    return ts;
  },
  /** 某个时区里 ts 所在那一天的 [零点, 次日零点) */
  dayRange(ts: number, timeZone?: string): [number, number] {
    const key = this.dateKey(ts, timeZone);
    const start = this.zoned(key, '00:00', timeZone);
    const next = this.zoned(this.dateKey(start + 36 * 3600_000, timeZone), '00:00', timeZone);
    return [start, next];
  },
  /** 给 <input type="datetime-local"> 用的值（设备本地时区） */
  toInput(ts: number): string {
    const d = new Date(ts);
    const n = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())}T${n(d.getHours())}:${n(d.getMinutes())}`;
  },
  /** datetime-local / date 的值转时间戳；不合法返回 null */
  fromInput(v: string): number | null {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  },
};

/** 时区在 ts 这一刻比 UTC 快多少毫秒 */
function offset(ts: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ts));
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

function tz(timeZone?: string) {
  if (!timeZone) return {};
  try { new Intl.DateTimeFormat('zh-CN', { timeZone }); return { timeZone }; } catch { return {}; }
}

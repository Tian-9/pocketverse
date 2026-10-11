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

function tz(timeZone?: string) {
  if (!timeZone) return {};
  try { new Intl.DateTimeFormat('zh-CN', { timeZone }); return { timeZone }; } catch { return {}; }
}

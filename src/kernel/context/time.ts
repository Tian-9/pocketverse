/** 时间那一行：给模型看的"现在几点"。角色设了别的时区就多给一个他那边的时间。 */

export function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: tz }); return true; } catch { return false; }
}

const fmt = (d: Date, timeZone?: string) => d.toLocaleString('zh-CN', { hour12: false, ...(timeZone ? { timeZone } : {}) });

/**
 * `现在是 2026/10/11 09:30:00。`；角色时区有效且和本机不同时：
 * `现在是 2026/10/11 09:30:00（你在 Asia/Tokyo，那边是 2026/10/11 17:30:00）。`
 * 不合法的时区当没设。
 */
export function timeLine(now: Date, characterTimeZone?: string, local = localTimeZone()): string {
  const tz = characterTimeZone?.trim();
  if (!tz || tz === local || !isValidTimeZone(tz)) return `现在是 ${fmt(now)}。`;
  return `现在是 ${fmt(now)}（你在 ${tz}，那边是 ${fmt(now, tz)}）。`;
}

import type { Place } from '$kernel/api';

/**
 * 天气查询：Open-Meteo，免费、无 Key、允许跨域，在浏览器里直接请求，不经过模型。
 * 查不到就 null，调用方沉默（提示词里没有那一句，不给模型报错）。设计见 designs/weather.md。
 */
type Fetch = typeof fetch;
const TIMEOUT = 8000;
/** 当前天气缓存多久 */
export const TTL = 30 * 60_000;

export interface Day { date: string; code: number; desc: string; max: number; min: number; precip: number; sunrise?: string; sunset?: string }
export interface Weather {
  place: string;
  code: number; desc: string;
  temp: number; feels: number; humidity: number;
  windKmh: number; windLevel: number; windDir: string;
  isDay: boolean;
  /** 今天起 7 天 */
  daily: Day[];
  fetchedAt: number;
}

/** WMO 天气码 → 中文 */
export function describeCode(code: number): string {
  if (code === 0) return '晴';
  if (code === 1) return '大致晴';
  if (code === 2) return '多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code === 61 || code === 80) return '小雨';
  if (code === 63 || code === 81) return '中雨';
  if (code === 65 || code === 82) return '大雨';
  if (code === 66 || code === 67) return '冻雨';
  if (code === 71 || code === 85) return '小雪';
  if (code === 73) return '中雪';
  if (code === 75 || code === 86) return '大雪';
  if (code === 77) return '雪粒';
  if (code === 95) return '雷阵雨';
  if (code === 96 || code === 99) return '雷阵雨伴冰雹';
  return '多云';
}
export const isWet = (code: number) => code >= 51;

/** 蒲福风级，输入 km/h */
export function beaufort(kmh: number): number {
  const t = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  return t.findIndex((x) => kmh < x) === -1 ? 12 : t.findIndex((x) => kmh < x);
}
export function windDirection(deg: number): string {
  const d = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return d[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

interface Resp {
  current?: { temperature_2m?: number; apparent_temperature?: number; relative_humidity_2m?: number; is_day?: number; weather_code?: number; wind_speed_10m?: number; wind_direction_10m?: number };
  daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[]; sunrise?: string[]; sunset?: string[] };
}

export function url(p: Place): string {
  const q = [
    `latitude=${p.lat}`, `longitude=${p.lon}`,
    'current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    'timezone=auto', 'forecast_days=7',
  ];
  return `https://api.open-meteo.com/v1/forecast?${q.join('&')}`;
}

export function parse(p: Place, data: Resp, now = Date.now()): Weather | null {
  const c = data.current;
  if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.weather_code)) return null;
  const d = data.daily ?? {};
  const daily: Day[] = (d.time ?? []).map((date, i) => ({
    date, code: d.weather_code?.[i] ?? 0, desc: describeCode(d.weather_code?.[i] ?? 0),
    max: Math.round(d.temperature_2m_max?.[i] ?? NaN), min: Math.round(d.temperature_2m_min?.[i] ?? NaN),
    precip: d.precipitation_probability_max?.[i] ?? 0,
    sunrise: d.sunrise?.[i]?.slice(11, 16), sunset: d.sunset?.[i]?.slice(11, 16),
  })).filter((x) => Number.isFinite(x.max) && Number.isFinite(x.min));
  const kmh = c.wind_speed_10m ?? 0;
  return {
    place: p.name, code: c.weather_code!, desc: describeCode(c.weather_code!),
    temp: Math.round(c.temperature_2m!), feels: Math.round(c.apparent_temperature ?? c.temperature_2m!), humidity: Math.round(c.relative_humidity_2m ?? 0),
    windKmh: Math.round(kmh), windLevel: beaufort(kmh), windDir: windDirection(c.wind_direction_10m ?? 0),
    isDay: c.is_day !== 0, daily, fetchedAt: now,
  };
}

const cache = new Map<string, Weather>();
export const cacheKey = (p: Place) => `${p.lat},${p.lon}`;
export function clearCache() { cache.clear(); }

/** 当前天气 + 7 天预报，30 分钟内同一地点不重复请求。失败 null */
export async function fetchWeather(p: Place, f: Fetch = fetch, now = Date.now(), force = false): Promise<Weather | null> {
  const key = cacheKey(p);
  const hit = cache.get(key);
  if (!force && hit && now - hit.fetchedAt < TTL) return hit.place === p.name ? hit : { ...hit, place: p.name };
  try {
    const res = await f(url(p), { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const w = parse(p, (await res.json()) as Resp, now);
    if (w) cache.set(key, w);
    return w;
  } catch { return null; }
}

/** 「多云，18°C，体感 16°C，东北风 2 级」 */
export function brief(w: Weather, withFeels = true): string {
  const parts = [w.desc, `${w.temp}°C`];
  if (withFeels && Math.abs(w.feels - w.temp) >= 2) parts.push(`体感 ${w.feels}°C`);
  if (w.windLevel >= 3) parts.push(`${w.windDir}风 ${w.windLevel} 级`);
  return parts.join('，');
}
/** 「今天 12～21°C，降水概率 60%」 */
export function todayLine(w: Weather): string {
  const t = w.daily[0];
  if (!t) return '';
  const parts = [`今天 ${t.min}～${t.max}°C`];
  if (t.precip >= 30 && !isWet(w.code)) parts.push(`降水概率 ${t.precip}%`);
  return parts.join('，');
}

/**
 * 进提示词的那一句。mine 是他那边，yours 是对方（用户）那边；同一个地方只传 mine。
 * 「（你们这边现在：伦敦，多云，18°C；今天 12～21°C。）」
 * 「（你那边现在：东京，晴，22°C；对方那边：伦敦，多云，18°C，今天可能下雨。）」
 */
export function promptLine(mine: Weather | null, yours: Weather | null): string {
  if (mine && yours) {
    const t = yours.daily[0];
    const rain = t && t.precip >= 50 && !isWet(yours.code) ? '，今天可能下雨' : '';
    const today = todayLine(mine);
    return `（你那边现在：${mine.place}，${brief(mine)}${today ? '；' + today : ''}；对方那边：${yours.place}，${brief(yours, false)}${rain}。）`;
  }
  const w = mine ?? yours;
  if (!w) return '';
  const today = todayLine(w);
  return `（你们这边现在：${w.place}，${brief(w)}${today ? '；' + today : ''}。）`;
}

/** 给工具看的预报：一行一天 */
export function forecastText(w: Weather, days = 7): string {
  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const rows = w.daily.slice(0, Math.max(1, Math.min(7, days))).map((d, i) => {
    const wd = WD[new Date(d.date + 'T00:00').getDay()];
    const label = i === 0 ? '今天' : i === 1 ? '明天' : `${d.date.slice(5).replace('-', '/')} ${wd}`;
    return `- ${label}：${d.desc}，${d.min}～${d.max}°C${d.precip >= 30 ? `，降水概率 ${d.precip}%` : ''}`;
  });
  return `${w.place} 现在：${brief(w)}\n${rows.join('\n')}`;
}

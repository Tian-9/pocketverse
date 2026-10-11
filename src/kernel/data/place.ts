import type { Place } from '../api/types';
import { db } from '../storage/db';
import { isValidTimeZone, localTimeZone } from '../context/time';

/**
 * 位置：时区和天气的根。角色卡上「他在哪座城市」、设置里「你在哪座城市」都是一个 Place。
 * 地理编码走 Open-Meteo（免费、无 Key、允许跨域，自带时区）；定位走浏览器 Geolocation，坐标只留两位小数（约 1 公里）。
 * 任何一步失败都返回空 / null，不抛给界面之外。设计见 designs/weather.md。
 */
type Fetch = typeof fetch;
const TIMEOUT = 8000;
const get = (f: Fetch) => (url: string) => f(url, { signal: AbortSignal.timeout(TIMEOUT) });

/** 代码里的默认值：伦敦。真实位置只存在这台设备的浏览器里，不进仓库 */
export const DEFAULT_USER_PLACE: Place = { name: '伦敦', lat: 51.51, lon: -0.13, timeZone: 'Europe/London' };
const KV = 'kernel.userPlace';

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const samePlace = (a: Place | undefined, b: Place | undefined) => !!a && !!b && round2(a.lat) === round2(b.lat) && round2(a.lon) === round2(b.lon);

export function isPlace(v: unknown): v is Place {
  const p = v as Place | null;
  return !!p && typeof p === 'object' && typeof p.name === 'string' && !!p.name.trim()
    && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && typeof p.timeZone === 'string';
}

/** 地理编码返回的候选：多带一行给人看的归属（省 · 国家） */
export interface PlaceCandidate extends Place { detail: string }

interface GeoResult { name?: string; latitude?: number; longitude?: number; country?: string; admin1?: string; timezone?: string }

export async function geocode(query: string, f: Fetch = fetch): Promise<PlaceCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await get(f)(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=zh&format=json`);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: GeoResult[] };
    return (data.results ?? []).flatMap((r) => {
      if (!r.name || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return [];
      const tz = r.timezone && isValidTimeZone(r.timezone) ? r.timezone : localTimeZone();
      const detail = [r.admin1, r.country].filter((x) => x && x !== r.name).join(' · ');
      return [{ name: r.name, lat: round2(r.latitude!), lon: round2(r.longitude!), timeZone: tz, detail }];
    });
  } catch { return []; }
}

interface ReverseResult { city?: string; locality?: string; principalSubdivision?: string; countryName?: string }

/** 坐标 → 城市名；查不到返回 null，调用方自己兜底 */
export async function reverseGeocode(lat: number, lon: number, f: Fetch = fetch): Promise<string | null> {
  try {
    const res = await get(f)(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`);
    if (!res.ok) return null;
    const r = (await res.json()) as ReverseResult;
    return r.city || r.locality || r.principalSubdivision || null;
  } catch { return null; }
}

/** 浏览器定位：拿到的坐标抹到两位小数，城市名反查不到就叫「当前位置」，时区取设备的。没权限 / 不支持抛错，界面显示 */
export async function locate(f: Fetch = fetch): Promise<Place> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('这个浏览器不支持定位');
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? '没有定位权限，可以直接输入城市' : '定位失败，可以直接输入城市')), { timeout: 10_000, maximumAge: 600_000 }));
  const lat = round2(pos.coords.latitude), lon = round2(pos.coords.longitude);
  const name = (await reverseGeocode(lat, lon, f)) ?? '当前位置';
  return { name, lat, lon, timeZone: localTimeZone() };
}

export const places = {
  DEFAULT_USER_PLACE,
  geocode, reverseGeocode, locate, isPlace, samePlace,
  /** 你在哪座城市。没改过就是默认值 */
  async user(): Promise<Place> {
    const v = await db().getKV<unknown>(KV, null);
    return isPlace(v) ? v : DEFAULT_USER_PLACE;
  },
  async setUser(p: Place): Promise<void> {
    await db().setKV(KV, { name: p.name.trim(), lat: round2(p.lat), lon: round2(p.lon), timeZone: p.timeZone });
  },
};

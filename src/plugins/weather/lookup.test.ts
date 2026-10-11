import { describe, it, expect, beforeEach } from 'vitest';
import { beaufort, describeCode, windDirection, parse, fetchWeather, promptLine, forecastText, clearCache, TTL, type Weather } from './lookup';
import type { Place } from '$kernel/api';

const london: Place = { name: '伦敦', lat: 51.51, lon: -0.13, timeZone: 'Europe/London' };
const tokyo: Place = { name: '东京', lat: 35.68, lon: 139.69, timeZone: 'Asia/Tokyo' };
const resp = (temp: number, code: number, precip = 10) => ({
  current: { temperature_2m: temp, apparent_temperature: temp - 2.4, relative_humidity_2m: 70, is_day: 1, weather_code: code, wind_speed_10m: 14, wind_direction_10m: 45 },
  daily: { time: ['2026-10-11', '2026-10-12', '2026-10-13'], weather_code: [code, 61, 0], temperature_2m_max: [21.2, 19, 18], temperature_2m_min: [12.4, 11, 9], precipitation_probability_max: [precip, 80, 0], sunrise: ['2026-10-11T07:20', '2026-10-12T07:22', '2026-10-13T07:24'], sunset: ['2026-10-11T18:10', '2026-10-12T18:08', '2026-10-13T18:06'] },
});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
let calls: string[] = [];
const fetchOk = ((u: string) => { calls.push(u); return json(resp(u.includes('139.69') ? 22 : 18, u.includes('139.69') ? 0 : 2, 60)); }) as unknown as typeof fetch;

beforeEach(() => { clearCache(); calls = []; });

describe('weather lookup', () => {
  it('maps codes, wind and direction', () => {
    expect(describeCode(0)).toBe('晴');
    expect(describeCode(3)).toBe('阴');
    expect(describeCode(63)).toBe('中雨');
    expect(describeCode(95)).toBe('雷阵雨');
    expect(beaufort(0)).toBe(0); expect(beaufort(14)).toBe(3); expect(beaufort(200)).toBe(12);
    expect(windDirection(45)).toBe('东北'); expect(windDirection(350)).toBe('北'); expect(windDirection(-90)).toBe('西');
  });

  it('parses current + daily and rounds', () => {
    const w = parse(london, resp(18.4, 2))!;
    expect(w).toMatchObject({ place: '伦敦', desc: '多云', temp: 18, feels: 16, humidity: 70, windLevel: 3, windDir: '东北', isDay: true });
    expect(w.daily).toHaveLength(3);
    expect(w.daily[0]).toMatchObject({ date: '2026-10-11', max: 21, min: 12, sunrise: '07:20', sunset: '18:10' });
    expect(parse(london, {})).toBeNull();
  });

  it('caches for 30 minutes per coordinate and refetches after', async () => {
    const t0 = 1_000_000;
    const a = await fetchWeather(london, fetchOk, t0);
    const b = await fetchWeather(london, fetchOk, t0 + TTL - 1);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
    await fetchWeather(london, fetchOk, t0 + TTL + 1);
    expect(calls).toHaveLength(2);
  });

  it('returns null on error or bad status without throwing', async () => {
    expect(await fetchWeather(london, (() => json({}, 500)) as unknown as typeof fetch)).toBeNull();
    expect(await fetchWeather(london, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull();
  });

  it('builds the prompt line for one place and for two', async () => {
    const mine = (await fetchWeather(tokyo, fetchOk))!;
    const yours = (await fetchWeather(london, fetchOk))!;
    expect(promptLine(yours, null)).toBe('（你们这边现在：伦敦，多云，18°C，体感 16°C，东北风 3 级；今天 12～21°C，降水概率 60%。）');
    expect(promptLine(mine, yours)).toBe('（你那边现在：东京，晴，22°C，体感 20°C，东北风 3 级；今天 12～21°C，降水概率 60%；对方那边：伦敦，多云，18°C，东北风 3 级，今天可能下雨。）');
    expect(promptLine(null, null)).toBe('');
  });

  it('writes a forecast the character can read', () => {
    const w: Weather = parse(london, resp(18, 2, 60))!;
    const t = forecastText(w, 3);
    expect(t.split('\n')).toHaveLength(4);
    expect(t).toContain('- 今天：多云，12～21°C，降水概率 60%');
    expect(t).toContain('- 明天：小雨，11～19°C，降水概率 80%');
    expect(t).toContain('10/13 周二：晴，9～18°C');
  });
});

import { describe, it, expect } from 'vitest';
import { timeLine, isValidTimeZone } from './time';

const d = new Date(Date.UTC(2026, 9, 11, 9, 30, 0));

describe('timeLine', () => {
  it('gives only the local time when the character has no zone, the same zone, or an invalid one', () => {
    expect(timeLine(d, undefined, 'UTC')).toBe(`现在是 ${d.toLocaleString('zh-CN', { hour12: false })}。`);
    expect(timeLine(d, 'UTC', 'UTC')).not.toContain('那边');
    expect(timeLine(d, 'Mars/Phobos', 'UTC')).not.toContain('那边');
    expect(timeLine(d, '  ', 'UTC')).not.toContain('那边');
  });
  it('adds the character-side time when the zone differs', () => {
    const line = timeLine(d, 'Asia/Tokyo', 'UTC');
    expect(line).toContain('你在 Asia/Tokyo，那边是 ');
    expect(line).toContain('18:30:00');
  });
  it('validates IANA names', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Nowhere')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

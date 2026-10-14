import { describe, it, expect } from 'vitest';
import { agoText, dayDivider, dayOf, memoryWhen, storyStartOf } from './days';
import { clock } from './clock';

const at = (d: string, t = '12:00') => clock.zoned(d, t);
const start = at('2026-09-01', '08:00');

describe('days', () => {
  it('counts calendar days from the story start, day 1 included', () => {
    expect(dayOf(start, start)).toBe(1);
    expect(dayOf(at('2026-09-01', '23:59'), start)).toBe(1);
    expect(dayOf(at('2026-09-02', '00:01'), start)).toBe(2);
    expect(dayOf(at('2026-10-10'), start)).toBe(40);
    expect(dayOf(at('2027-10-06'), start)).toBe(401);
  });
  it('gets coarser the longer ago', () => {
    expect([0, 1, 2, 7, 44, 60, 200, 400, 800].map(agoText)).toEqual(['今天', '昨天', '前天', '7 天前', '44 天前', '约 2 个月前', '约 7 个月前', '约 1 年前', '约 2 年前']);
  });
  it('renders a memory as Day N (date, part of day, how long ago); old relative wording is cleaned', () => {
    const now = at('2026-10-10', '20:00');
    expect(memoryWhen({ storyTs: at('2026-10-06', '21:00'), when: '晚上' }, start, now)).toBe('Day 36（10/6 周二 晚上，4 天前）');
    expect(memoryWhen({ storyTs: at('2026-09-08'), when: '今天晚上' }, start, now)).toBe('Day 8（9/8 周二 晚上，32 天前）');
    expect(memoryWhen({ when: '导入前' }, start, now)).toBe('导入前');
    expect(dayDivider(at('2026-10-06'), start)).toBe('—— Day 36 · 10/6 周二 ——');
  });
  it('finds the start: recorded, else the clock anchor, else creation time', () => {
    expect(storyStartOf({ storyStart: 5, createdAt: 9 })).toBe(5);
    expect(storyStartOf({ clock: { anchorStoryTs: 7, anchorRealTs: 0, running: true }, createdAt: 9 })).toBe(7);
    expect(storyStartOf({ createdAt: 9 })).toBe(9);
  });
});

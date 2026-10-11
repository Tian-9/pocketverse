import { describe, it, expect } from 'vitest';
import { clock } from './clock';

const H = 3600_000, D = 24 * H;
const real = Date.UTC(2026, 9, 11, 9, 30);

describe('clock', () => {
  it('no clock means real time', () => {
    expect(clock.now(undefined, real)).toBe(real);
    expect(clock.aligned(undefined, real)).toBe(true);
  });
  it('running clock keeps its offset as real time passes', () => {
    const c = clock.skipBy(undefined, 3 * D, real);
    expect(clock.now(c, real)).toBe(real + 3 * D);
    expect(clock.now(c, real + H)).toBe(real + 3 * D + H);
    expect(clock.aligned(c, real)).toBe(false);
  });
  it('paused clock only moves when skipped', () => {
    const c = clock.setRunning(clock.skipTo(undefined, real - 10 * D, real), false, real);
    expect(clock.now(c, real + 5 * D)).toBe(real - 10 * D);
    const moved = clock.skipBy(c, 2 * H, real + 5 * D);
    expect(moved.running).toBe(false);
    expect(clock.now(moved, real + 9 * D)).toBe(real - 10 * D + 2 * H);
  });
  it('resuming a paused clock continues from where it stopped', () => {
    const paused = clock.setRunning(clock.skipTo(undefined, real - D, real), false, real);
    const resumed = clock.setRunning(paused, true, real + D);
    expect(clock.now(resumed, real + D)).toBe(real - D);
    expect(clock.now(resumed, real + 2 * D)).toBe(real);
  });
  it('a running clock with zero offset is aligned', () => {
    expect(clock.aligned({ anchorStoryTs: real, anchorRealTs: real, running: true }, real + D)).toBe(true);
    expect(clock.aligned({ anchorStoryTs: real, anchorRealTs: real, running: false }, real + D)).toBe(false);
  });
  it('formats and keys dates in a zone', () => {
    expect(clock.dateKey(real, 'UTC')).toBe('2026-10-11');
    expect(clock.dateKey(real, 'Asia/Tokyo')).toBe('2026-10-11');
    expect(clock.dateKey(Date.UTC(2026, 9, 11, 16, 0), 'Asia/Tokyo')).toBe('2026-10-12');
    expect(clock.format(real, 'UTC')).toContain('09:30');
    expect(clock.format(real, 'Mars/Phobos')).toBeTruthy();
  });
  it('round-trips datetime-local input', () => {
    const t = new Date(2026, 9, 11, 8, 0).getTime();
    expect(clock.fromInput(clock.toInput(t))).toBe(t);
    expect(clock.fromInput('')).toBeNull();
    expect(clock.fromInput('nope')).toBeNull();
  });
});

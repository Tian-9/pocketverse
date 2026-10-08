import { describe, it, expect } from 'vitest';
import { costUsd, cacheHitRate } from './pricing';

describe('pricing', () => {
  it('computes Opus 5.5 cost with cache split', () => {
    const c = costUsd('claude-opus-5-5', { input: 1000, output: 500, cacheRead: 44000, cacheWrite: 0 });
    // 1000*4 + 500*20 + 44000*0.2 = 4000 + 10000 + 8800 = 22800 / 1e6
    expect(c).toBeCloseTo(0.0228, 6);
  });
  it('returns 0 for unknown model and handles empty usage', () => {
    expect(costUsd('nope', { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 })).toBe(0);
    expect(cacheHitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
    expect(cacheHitRate({ input: 1000, output: 0, cacheRead: 9000, cacheWrite: 0 })).toBeCloseTo(0.9);
  });
});

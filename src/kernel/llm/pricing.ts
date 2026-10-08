import type { Usage } from './types';

/** 美元 / 百万 token。缓存写按输入价 1.25 倍。 */
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

export const MODELS: { id: string; label: string; note: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '默认。输入 $4 / 输出 $20 每百万 token' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '更快更便宜。$2 / $10' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: '最便宜。$0.1 / $0.5，用于后台合并' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: '最强。$10 / $50' },
];

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

/** 缓存命中率：缓存读 / 全部输入。 */
export function cacheHitRate(u: Usage): number {
  const total = u.input + u.cacheRead + u.cacheWrite;
  return total === 0 ? 0 : u.cacheRead / total;
}

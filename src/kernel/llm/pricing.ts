import type { Usage } from './types';
import type { ModelInfo } from './roles';

/** 美元 / 百万 token。缓存写按输入价 1.25 倍。 */
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** 内置模型表：API 拉不到列表时的兜底。 */
export const MODELS: ModelInfo[] = [
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];

/** 列表里显示的价格一句话：「输入 $4 / 输出 $20 每百万 token」，表里没有就「价格未知」。 */
export function priceNote(model: string): string {
  const p = PRICES[model];
  if (!p) return '价格未知，用量按 $0 记';
  const n = (x: number) => (x >= 1 ? String(x) : x.toFixed(2).replace(/0+$/, ''));
  return `输入 $${n(p.input)} / 输出 $${n(p.output)} 每百万 token`;
}

/** 服务端联网搜索：每次 $0.01（$10 / 1000 次），另加搜到内容占的 token */
export const WEB_SEARCH_USD = 0.01;

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  const web = (u.webSearches ?? 0) * WEB_SEARCH_USD;
  if (!p) return web;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000 + web;
}

/** 缓存命中率：缓存读 / 全部输入。 */
export function cacheHitRate(u: Usage): number {
  const total = u.input + u.cacheRead + u.cacheWrite;
  return total === 0 ? 0 : u.cacheRead / total;
}

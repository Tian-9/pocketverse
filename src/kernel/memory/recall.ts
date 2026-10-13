import type { EpisodicMemory, Message } from '../storage/db';
import { search } from '../context/search';
import { textOf } from '../data/repo';

/** 每轮自动翻出几条：太多会挤占注意力，太少等于没有 */
export const RECALL_K = 3;
/**
 * 最低分：一个只在这条记忆里出现的核心词（idf 高）能过，满篇都有的常见词（idf 低）单独过不了。
 * 分数 = Σ 档位权重 × log(1 + 记忆数 / 含这个词的记忆数)，见 annals SparseIndex。
 */
export const RECALL_MIN_SCORE = 1;

/** 这一轮拿来搜的话：最后一条他的回复之后，你说的所有话 */
export function recallQuery(history: Message[]): string {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === 'assistant' && !m.meta?.narration) break;
    if (m.role === 'user') out.unshift(textOf(m));
  }
  return out.join('\n').trim();
}

/**
 * 自动召回：用你刚说的话在这一局的情节记忆里搜（annals 分档词袋 + 倒排，不调模型），
 * 已经常驻在「近期要事」里的跳过。结果进最后一条消息，不动缓存前缀。
 */
export function recallMemories(mems: EpisodicMemory[], query: string, exclude: Set<string> = new Set()): EpisodicMemory[] {
  if (!query) return [];
  const pool = mems.filter((m) => !exclude.has(m.id));
  const hits = search(pool.map((m) => ({ id: m.id, kind: 'mem', title: m.when, text: m.text, ...(m.bag ? { bag: m.bag } : {}) })), query, RECALL_K, { minScore: RECALL_MIN_SCORE });
  const byId = new Map(pool.map((m) => [m.id, m]));
  return hits.map((h) => byId.get(h.id)!).filter(Boolean);
}

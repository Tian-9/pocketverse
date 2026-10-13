import type { EpisodicMemory, Message } from '../storage/db';
import { SparseIndex } from 'annals';
import { search, docBag } from '../context/search';
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

export interface RecallExplain {
  memory: EpisodicMemory;
  score: number;
  /** 靠哪些词命中的（索引里的词，可能是词袋原词、切出来的子词或正文里的词） */
  terms: string[];
  /** recalled：这一轮会被召回；pinned：三星常驻，不重复召回；weak：分数不够；overflow：够分但排在前 3 之后 */
  status: 'recalled' | 'pinned' | 'weak' | 'overflow';
}

/**
 * 检索试验台用：和 recallMemories 同一套索引和打分，但列出所有命中，带分数、命中词和结论。
 * 不调模型，不发消息。
 */
export function explainRecall(mems: EpisodicMemory[], query: string, pinned: Set<string> = new Set(), limit = 10): RecallExplain[] {
  if (!query.trim()) return [];
  const idx = new SparseIndex();
  for (const m of mems) idx.add(m.id, docBag({ id: m.id, kind: 'mem', title: m.when, text: m.text, ...(m.bag ? { bag: m.bag } : {}) }));
  const byId = new Map(mems.map((m) => [m.id, m]));
  let recalled = 0;
  return idx.search(query, { k: limit }).map((h) => {
    const memory = byId.get(h.id)!;
    let status: RecallExplain['status'];
    if (pinned.has(h.id)) status = 'pinned';
    else if (h.score < RECALL_MIN_SCORE) status = 'weak';
    else status = recalled++ < RECALL_K ? 'recalled' : 'overflow';
    return { memory, score: h.score, terms: h.terms, status };
  });
}

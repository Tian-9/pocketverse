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
/**
 * 冷却：最近这么多轮回复里带过的记忆，这一轮不再带。治的是"他每轮都提同一件事"。
 * 按轮数不按时间，没带记忆的轮也算一轮；过了这几轮还相关，可以再想起来。
 */
export const RECALL_COOLDOWN_TURNS = 5;

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
 * 最近 turns 轮回复带过的记忆 id。每轮回复的气泡都有 meta.turn，带过的记忆记在 meta.surfaced：
 * 回复没成功就没有气泡，删掉或重新生成那一轮气泡就没了，这里自然不算。
 */
export function recentlySurfaced(history: Message[], turns = RECALL_COOLDOWN_TURNS): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    const turn = m.role === 'assistant' ? m.meta?.turn : undefined;
    if (typeof turn !== 'string') continue;
    if (!seen.has(turn)) { if (seen.size >= turns) break; seen.add(turn); }
    const ids = m.meta?.surfaced;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.add(id);
  }
  return out;
}

/**
 * 自动召回：用你刚说的话在这一局的情节记忆里搜（annals 分档词袋 + 倒排，不调模型），
 * 已经常驻在「近期要事」里的跳过。结果进最后一条消息，不动缓存前缀。
 * cooled 是冷却中的记忆：先选出前 RECALL_K 条，再把冷却的划掉，空位不补。
 * 最相关的那条刚提过，这轮就少带一条，不拿排在后面、没那么相关的凑数。
 */
export function recallMemories(mems: EpisodicMemory[], query: string, exclude: Set<string> = new Set(), cooled: Set<string> = new Set()): EpisodicMemory[] {
  if (!query) return [];
  const pool = mems.filter((m) => !exclude.has(m.id));
  const hits = search(pool.map((m) => ({ id: m.id, kind: 'mem', title: '', text: m.text, ...(m.bag ? { bag: m.bag } : {}) })), query, RECALL_K, { minScore: RECALL_MIN_SCORE });
  const byId = new Map(pool.map((m) => [m.id, m]));
  return hits.filter((h) => !cooled.has(h.id)).map((h) => byId.get(h.id)!).filter(Boolean);
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
  for (const m of mems) idx.add(m.id, docBag({ id: m.id, kind: 'mem', title: '', text: m.text, ...(m.bag ? { bag: m.bag } : {}) }));
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

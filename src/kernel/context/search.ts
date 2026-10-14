import { SparseIndex, bagFromText, tokenize, type Bag } from 'annals';

export { tokenize };

export interface Doc { id: string; title: string; text: string; kind: string; /** 模型给的词袋；没有就按标题和正文分词 */ bag?: Bag }

/**
 * 文档的词袋。有模型词袋的只按词袋：召回认关键词，不认正文里碰巧出现的字（「去」「说」「买」）。
 * 没有词袋的（世界书条目、整理没跑通前的老记忆）才用纯词法兜底：标题是 core、正文是 related，正文的单字不要。
 */
export function docBag(d: Doc): Bag {
  if (d.bag) return d.bag;
  const b = bagFromText({ core: d.title, related: d.text });
  const related = b.related?.filter((t) => [...t].length >= 2);
  return { ...(b.core?.length ? { core: b.core } : {}), ...(related?.length ? { related } : {}) };
}

/** 对一小批文档建临时索引并查询。数据量小（几百条），每次重建比维护增量索引省心。 */
export function search(docs: Doc[], query: string, limit = 8, opts: { minScore?: number } = {}): { id: string; score: number }[] {
  if (!docs.length || !query.trim()) return [];
  const idx = new SparseIndex();
  for (const d of docs) idx.add(d.id, docBag(d));
  return idx.search(query, { k: limit, ...(opts.minScore !== undefined ? { minScore: opts.minScore } : {}) }).map((h) => ({ id: h.id, score: h.score }));
}

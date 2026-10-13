import { SparseIndex, bagFromText, tokenize, type Bag } from 'annals';

export { tokenize };

export interface Doc { id: string; title: string; text: string; kind: string; /** 模型给的词袋；没有就按标题和正文分词 */ bag?: Bag }

/** 文档的词袋：有模型词袋的，正文分词作弱提示补上；没有的，标题是 core、正文是 related（纯词法基线） */
export function docBag(d: Doc): Bag {
  if (!d.bag) return bagFromText({ core: d.title, related: d.text });
  return { ...d.bag, hint: [...(d.bag.hint ?? []), ...tokenize(d.text)] };
}

/** 对一小批文档建临时索引并查询。数据量小（几百条），每次重建比维护增量索引省心。 */
export function search(docs: Doc[], query: string, limit = 8, opts: { minScore?: number } = {}): { id: string; score: number }[] {
  if (!docs.length || !query.trim()) return [];
  const idx = new SparseIndex();
  for (const d of docs) idx.add(d.id, docBag(d));
  return idx.search(query, { k: limit, ...(opts.minScore !== undefined ? { minScore: opts.minScore } : {}) }).map((h) => ({ id: h.id, score: h.score }));
}

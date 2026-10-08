import MiniSearch from 'minisearch';

const CJK = /[　-鿿豈-﫿＀-￯]/;

/** 中英混合分词：CJK 连续段切成二元组（单字段也保留单字），其他按非字母数字切。 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let run = '';
  const flushRun = () => {
    if (!run) return;
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    run = '';
  };
  let word = '';
  const flushWord = () => { if (word) out.push(word.toLowerCase()); word = ''; };
  for (const ch of text) {
    if (CJK.test(ch)) { flushWord(); run += ch; }
    else if (/[\p{L}\p{N}]/u.test(ch)) { flushRun(); word += ch; }
    else { flushRun(); flushWord(); }
  }
  flushRun(); flushWord();
  return out;
}

export interface Doc { id: string; title: string; text: string; kind: string }

/** 对一小批文档建临时索引并查询。数据量小（几百条），每次重建比维护增量索引省心。 */
export function search(docs: Doc[], query: string, limit = 8): { id: string; score: number }[] {
  if (!docs.length || !query.trim()) return [];
  const ms = new MiniSearch<Doc>({
    fields: ['title', 'text'],
    storeFields: ['id'],
    tokenize,
    searchOptions: { boost: { title: 2 }, prefix: false, fuzzy: 0, combineWith: 'OR' },
  });
  ms.addAll(docs);
  return ms.search(query).slice(0, limit).map((r) => ({ id: r.id as string, score: r.score }));
}

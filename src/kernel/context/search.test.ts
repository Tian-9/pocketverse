import { describe, it, expect } from 'vitest';
import { tokenize, search, docBag } from './search';

describe('search', () => {
  it('tokenizes mixed CJK and latin into words and bigrams (annals), dropping stopwords', () => {
    const t = tokenize('雨天的邮差 Postman 2');
    expect(t).toEqual(expect.arrayContaining(['雨天', '邮差', '的邮', 'postman', '2']));
    expect(t).not.toContain('的');
    expect(tokenize('书')).toEqual(['书']);
  });
  it('uses the model bag when a memory has one, and nothing from its text', () => {
    const docs = [
      { id: 'fish', kind: 'mem', title: '昨晚', text: '猫偷吃了案板上的小鱼干', bag: { core: ['猫', '黑炭', '小鱼干'], related: ['偷吃'] } },
      { id: 'cat2', kind: 'mem', title: '上周', text: '猫在客栈门口晒太阳' },
    ];
    expect(docBag(docs[1]!).core).toEqual(['上周']);
    expect(docBag(docs[1]!).related?.every((t) => [...t].length >= 2)).toBe(true);
    expect(docBag(docs[0]!)).toEqual(docs[0]!.bag);
    expect(search(docs, '案板')).toEqual([]);
    expect(search(docs, '黑炭昨天晚上吃了什么')[0]?.id).toBe('fish');
  });
  it('finds the relevant lore entry for a Chinese query', () => {
    const docs = [
      { id: 'a', kind: 'lore', title: '邮差', text: '雨天才出现的邮差，送来的信都是空的。' },
      { id: 'b', kind: 'lore', title: '图书馆', text: '市立图书馆三楼有一间不对外开放的阅览室。' },
    ];
    expect(search(docs, '空信的邮差')[0]?.id).toBe('a');
    expect(search(docs, '阅览室')[0]?.id).toBe('b');
    expect(search(docs, '')).toEqual([]);
  });
});

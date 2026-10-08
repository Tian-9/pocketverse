import { describe, it, expect } from 'vitest';
import { tokenize, search } from './search';

describe('search', () => {
  it('tokenizes mixed CJK and latin into bigrams and words', () => {
    expect(tokenize('雨天的邮差 Postman 2')).toEqual(['雨天', '天的', '的邮', '邮差', 'postman', '2']);
    expect(tokenize('书')).toEqual(['书']);
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

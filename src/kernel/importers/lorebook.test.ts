import { describe, it, expect } from 'vitest';
import { parseLorebook } from './lorebook';

describe('parseLorebook', () => {
  it('parses ST object-map format and card-embedded array format', () => {
    const st = { entries: { 0: { key: ['邮差', 'postman'], comment: '邮差', content: '雨天出现', constant: false, disable: false, order: 5 }, 1: { key: [], content: '常驻规则', constant: true } } };
    const r = parseLorebook(st);
    expect(r[0]).toMatchObject({ title: '邮差', triggers: { keywords: ['邮差', 'postman'] }, order: 5, enabled: true });
    expect(r[1]).toMatchObject({ title: '条目 2', constant: true });
    const card = { data: { entries: [{ keys: ['钟楼'], name: '钟楼', content: 'x', enabled: false, insertion_order: 3 }] } };
    expect(parseLorebook(card)[0]).toMatchObject({ title: '钟楼', enabled: false, order: 3 });
    expect(() => parseLorebook({})).toThrow();
  });
});

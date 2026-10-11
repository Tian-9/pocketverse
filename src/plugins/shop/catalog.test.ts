import { describe, it, expect } from 'vitest';
import { catalogUser, catalogSchema, parseCatalog } from './catalog';

const base = { worldName: '王都', worldSummary: '中世纪', loreDirectory: '- [a] 王宫：很大', time: '春分', location: '东市', happenings: ['城门塌了'], existing: ['黑麦面包'], categories: ['吃的', '穿的'] };

describe('shop catalog', () => {
  it('shelf prompt carries world, happenings, existing names and the task', () => {
    const u = catalogUser({ ...base, mode: { kind: 'shelf', categories: 5, perCategory: 5 } });
    for (const s of ['王都：中世纪', '王宫：很大', '春分', '东市', '城门塌了', '黑麦面包', '上架 5 个分类，每个分类 5 件']) expect(u).toContain(s);
  });

  it('category and search prompts name the category / query and the categories to pick from', () => {
    expect(catalogUser({ ...base, mode: { kind: 'category', category: '穿的', count: 5 } })).toContain('给「穿的」分类再上 5 件');
    const s = catalogUser({ ...base, mode: { kind: 'search', query: '围巾', count: 4 } });
    expect(s).toContain('有人在搜「围巾」');
    expect(s).toContain('吃的、穿的');
    expect(catalogUser({ ...base, categories: [], existing: [], mode: { kind: 'search', query: 'x', count: 1 } })).toContain('自己定一个');
    expect(catalogUser({ ...base, existing: [], loreDirectory: '', mode: { kind: 'shelf', categories: 1, perCategory: 1 } })).not.toContain('别重复');
  });

  it('schema requires items with all fields', () => {
    const s = catalogSchema() as { required: string[]; properties: { items: { items: { required: string[] } } } };
    expect(s.required).toEqual(['items']);
    expect(s.properties.items.items.required).toEqual(['category', 'name', 'price', 'desc', 'seller']);
  });

  it('parse drops broken items, rounds prices, and survives garbage', () => {
    const out = parseCatalog(JSON.stringify({ items: [
      { category: ' 吃的 ', name: '黑麦面包', price: 3.456, desc: '硬', seller: '老王面包房' },
      { category: '吃的', name: '免费的', price: 0, desc: 'x', seller: 's' },
      { category: '吃的', name: '没描述', price: 1, desc: '', seller: 's' },
      { category: '吃的', name: '价格坏了', price: 'abc', desc: 'x', seller: 's' },
      'junk',
    ] }));
    expect(out).toEqual([{ category: '吃的', name: '黑麦面包', price: 3.46, desc: '硬', seller: '老王面包房' }]);
    expect(parseCatalog('not json')).toEqual([]);
    expect(parseCatalog('{}')).toEqual([]);
  });
});

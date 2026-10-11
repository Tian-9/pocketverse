import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext, CampaignView } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin, { shopApi, KEEP_PRODUCTS, type Product, type ShopWallet } from './index';

const campaign: CampaignView = {
  id: 'cp1', name: '王都', worldId: 'w1', worldName: '王都', characterId: 'ch1', characterName: '阿一', lastPlayedAt: 1,
  state: { inWorldTime: '春分', location: '东市', relations: {}, mood: {}, facts: ['城门塌了'] },
};
let answer = '';
let lastUser = '';
const kv = new Map<string, unknown>();
const balances: Record<string, number> = { user: 100, ch1: 50 };
let walletOn = true;
const wallet: ShopWallet = {
  async balance(_cp, owner) { return balances[owner] ?? 0; },
  async charge(_cp, owner, amount) { if ((balances[owner] ?? 0) < amount) return false; balances[owner]! -= amount; return true; },
};

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'shop',
    emit() {}, navigate() {}, back() {}, notify() {},
    settings: { async get(k: string, f: unknown) { return kv.has(k) ? kv.get(k) : f; }, async set(k: string, v: unknown) { kv.set(k, v); } },
    table: (name: string) => db().table(pluginTable('shop', name)),
    llm: { configured: true, async chat(req: { user: string }) { lastUser = req.user; return { text: answer }; } },
    service: (name: string) => (name === 'wallet' && walletOn ? wallet : undefined),
    data: {
      async currentCampaigns() { return [campaign]; },
      async campaign(id: string) { return id === campaign.id ? campaign : undefined; },
      async world() { return { id: 'w1', name: '王都', summary: '中世纪' }; },
      async memories() { return [{ id: 'm', when: '', text: '国王病了', importance: 3 as const, createdAt: 1 }]; },
      async loreDirectory() { return '- [a] 王宫：很大'; },
    },
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
});

const item = (category: string, name: string, price = 10) => ({ category, name, price, desc: name + '的描述', seller: '老王铺子' });

describe('shop stock and search', () => {
  it('first stock generates products, records categories and stockedAt; second call is a no-op', async () => {
    answer = JSON.stringify({ items: [item('吃的', '黑麦面包', 3), item('穿的', '羊毛斗篷', 40), item('吃的', '蜂蜜酒', 8)] });
    const out = await shopApi.stock('cp1');
    expect(out).toHaveLength(3);
    for (const s of ['王都：中世纪', '王宫：很大', '春分', '东市', '城门塌了', '国王病了', '上架']) expect(lastUser).toContain(s);
    expect(await shopApi.categories('cp1')).toEqual(['吃的', '穿的']);
    expect(await shopApi.stockedAt('cp1')).toBeGreaterThan(0);
    expect(await shopApi.stock('cp1')).toBeNull();
    expect(await shopApi.all('cp1')).toHaveLength(3);
  });

  it('search hits locally without the model, else generates and tags source=search', async () => {
    lastUser = '';
    const local = await shopApi.search('cp1', '面包');
    expect(local.map((p) => p.name)).toEqual(['黑麦面包']);
    expect(lastUser).toBe('');
    answer = JSON.stringify({ items: [item('穿的', '羊毛围巾', 12)] });
    const gen = await shopApi.search('cp1', '围巾');
    expect(gen).toHaveLength(1);
    expect(gen[0]!.source).toBe('search');
    expect(lastUser).toContain('有人在搜「围巾」');
    expect(lastUser).toContain('吃的、穿的');
    expect(await shopApi.search('cp1', '')).toEqual([]);
  });

  it('refilling a category forces that category and lists what it already sells', async () => {
    answer = JSON.stringify({ items: [item('乱填的', '麦芽糖', 2)] });
    const out = await shopApi.generate('cp1', { kind: 'category', category: '吃的', count: 1 });
    expect(out![0]!.category).toBe('吃的');
    expect(lastUser).toContain('黑麦面包');
    expect(lastUser).not.toContain('羊毛斗篷');
  });

  it('find matches by name, exact before fuzzy', async () => {
    const all = await shopApi.all('cp1');
    expect(shopApi.find(all, '《羊毛围巾》')!.name).toBe('羊毛围巾');
    expect(shopApi.find(all, '斗篷')!.name).toBe('羊毛斗篷');
    expect(shopApi.find(all, '没有的')).toBeUndefined();
  });
});

describe('shop buy', () => {
  it('charges the buyer wallet, records the order, keeps the product; refuses when short or wallet off', async () => {
    const bread = shopApi.find(await shopApi.all('cp1'), '黑麦面包')!;
    const cloak = shopApi.find(await shopApi.all('cp1'), '羊毛斗篷')!;
    const o = await shopApi.buy(bread, { buyer: 'user', to: 'user', characterId: 'ch1', source: 'ui' });
    expect(o!.name).toBe('黑麦面包'); expect(o!.price).toBe(3);
    expect(balances.user).toBe(97);
    expect((await shopApi.products().get(bread.id))!.keep).toBe(true);
    // 他买给你：扣他的
    const g = await shopApi.buy(cloak, { buyer: 'char', to: 'user', characterId: 'ch1', note: '天冷', source: 'chat' });
    expect(g!.note).toBe('天冷'); expect(balances.ch1).toBe(10);
    // 他钱不够：一分不动，没订单
    expect(await shopApi.buy(cloak, { buyer: 'char', to: 'char', characterId: 'ch1', source: 'chat' })).toBeNull();
    expect(balances.ch1).toBe(10);
    expect(await shopApi.recentOrders('cp1')).toHaveLength(2);
    expect((await shopApi.recentOrders('cp1', 'user')).map((x) => x.name)).toEqual(['羊毛斗篷', '黑麦面包']);
    walletOn = false;
    await expect(shopApi.buy(bread, { buyer: 'user', to: 'user', characterId: 'ch1', source: 'ui' })).rejects.toThrow(/钱包/);
    walletOn = true;
  });
});

describe('shop prune', () => {
  it('drops search results first, never bought ones', async () => {
    const now = Date.now();
    const rows: Product[] = [];
    for (let i = 0; i < KEEP_PRODUCTS + 5; i++) rows.push({ id: 'x' + i, campaignId: 'cp2', name: 'n' + i, price: 1, category: 'c', desc: 'd', source: i % 2 ? 'search' : 'catalog', createdAt: now + i });
    rows[1]!.keep = true;
    await shopApi.products().bulkAdd(rows);
    await shopApi.prune('cp2');
    const left = await shopApi.all('cp2');
    expect(left).toHaveLength(KEEP_PRODUCTS + 1);
    expect(left.some((p) => p.id === 'x1')).toBe(true);
    // 删掉的是最老的搜索结果
    expect(left.some((p) => p.id === 'x3')).toBe(false);
    expect(left.some((p) => p.id === 'x0')).toBe(true);
  });
});

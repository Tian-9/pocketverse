import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext, CampaignView, PromptContext, CatchupContext } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin, { shopApi, type Product, type ShopWallet } from './index';
import { tools, volatile, collectBrowse } from './character';
import { productResolver, buildCard, validQuote } from './share';

const campaign: CampaignView = {
  id: 'cp1', name: '王都', worldId: 'w1', worldName: '王都', characterId: 'ch1', characterName: '阿一', lastPlayedAt: 1,
  now: Date.UTC(2026, 2, 20, 4, 0), aligned: false, state: { location: '东市', relations: {}, mood: {}, facts: [] },
};
const balances: Record<string, number> = { user: 100, ch1: 50 };
const wallet: ShopWallet = {
  async balance(_cp, owner) { return balances[owner] ?? 0; },
  async charge(_cp, owner, amount) { if ((balances[owner] ?? 0) < amount) return false; balances[owner]! -= amount; return true; },
};
const kv = new Map<string, unknown>();
let answer = '';
const notices: string[] = [];
const pc = (addCard?: PromptContext['addCard']): PromptContext => ({ campaignId: 'cp1', conversationId: 'cv1', characterIds: ['ch1'], now: Date.now(), addCard });
const tool = (name: string) => tools.find((t) => t.name === name)!;
// 补发的「现在」是剧情时刻（这局停在 2026-03-20），「刚买过」按它算
const cc: CatchupContext = { campaignId: 'cp1', characterId: 'ch1', characterName: '阿一', elapsedMs: 7 * 3600_000, from: campaign.now - 7 * 3600_000, to: campaign.now, now: campaign.now, days: 0, tier: 'h6', elapsedText: '大约 7 小时' };

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'shop',
    emit() {}, navigate() {}, back() {}, notify(t: string) { notices.push(t); },
    settings: { async get(k: string, f: unknown) { return kv.has(k) ? kv.get(k) : f; }, async set(k: string, v: unknown) { kv.set(k, v); } },
    table: (name: string) => db().table(pluginTable('shop', name)),
    llm: { configured: true, async chat() { return { text: answer }; } },
    service: (name: string) => (name === 'wallet' ? wallet : undefined),
    data: {
      async campaign(id: string) { return id === campaign.id ? campaign : undefined; },
      async world() { return { id: 'w1', name: '王都', summary: '' }; },
      async memories() { return []; },
      async loreDirectory() { return ''; },
    },
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
  const now = Date.now();
  const mk = (id: string, name: string, price: number, category: string, desc: string): Product => ({ id, campaignId: 'cp1', name, price, category, desc, seller: '老王铺子', source: 'catalog', createdAt: now + Number(id.slice(1)) });
  await shopApi.products().bulkAdd([mk('p1', '黑麦面包', 3, '吃的', '硬得能当武器'), mk('p2', '羊毛斗篷', 40, '穿的', '北方羊毛'), mk('p3', '蜂蜜酒', 8, '吃的', '酒馆自酿'), mk('p4', '羊毛围巾', 12, '穿的', '又软又暖')]);
  kv.set('categories.cp1', ['吃的', '穿的']);
  kv.set('stockedAt.cp1', now);
});

describe('character shops', () => {
  it('browse lists the shelf with numbers, searches locally, reads one by number', async () => {
    const list = (await tool('shop_browse').handler({}, pc())) as string;
    expect(list).toContain('1. 《蜂蜜酒》');
    expect(list).toContain('¥8.00');
    expect(list).toContain('shop_buy');
    const detail = (await tool('shop_browse').handler({ n: 1 }, pc())) as string;
    expect(detail).toContain('酒馆自酿');
    expect(await tool('shop_browse').handler({ n: 99 }, pc())).toContain('没有第 99 件');
    const hits = (await tool('shop_browse').handler({ query: '羊毛' }, pc())) as string;
    expect(hits).toContain('羊毛斗篷'); expect(hits).toContain('羊毛围巾'); expect(hits).not.toContain('面包');
  });

  it('buy for self charges his wallet and records; refuses without a listing or when short', async () => {
    await tool('shop_browse').handler({ query: '羊毛' }, pc());
    expect(await tool('shop_buy').handler({ n: 1 }, { ...pc(), conversationId: 'other' })).toContain('先用 shop_browse');
    const r = (await tool('shop_buy').handler({ n: 2 }, pc())) as string; // 新的在前：1 围巾 12，2 斗篷 40
    expect(r).toContain('已买下《羊毛斗篷》'); expect(balances.ch1).toBe(10);
    const short = (await tool('shop_buy').handler({ n: 2 }, pc())) as string;
    expect(short).toContain('买不起'); expect(balances.ch1).toBe(10);
    expect(await volatile(pc())).toBe('<商店>\n你有的东西：羊毛斗篷\n</商店>');
  });

  it('gift puts a share card with subtype gift and the note; volatile lists it as sent', async () => {
    balances.ch1 = 100;
    await tool('shop_browse').handler({ query: '围巾' }, pc());
    const cards: { tag: string; body: string; alt?: string }[] = [];
    const r = (await tool('shop_buy').handler({ n: 1, buy_for_them: true, note: '天冷' }, pc((tag, body, _a, alt) => cards.push({ tag, body, alt })))) as string;
    expect(r).toContain('送给对方'); expect(balances.ch1).toBe(88);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.tag).toBe('share'); expect(cards[0]!.alt).toBe('[买了《羊毛围巾》送给对方，留言「天冷」]');
    const card = JSON.parse(cards[0]!.body);
    expect(card).toMatchObject({ type: 'product', subtype: 'gift', title: '羊毛围巾', quote: '天冷', open: { pluginId: 'shop', screen: 'product', params: { id: 'p4' } } });
    const v = await volatile(pc());
    expect(v).toContain('你有的东西：羊毛斗篷'); expect(v).toContain('你送过对方：羊毛围巾');
    expect((await shopApi.recentOrders('cp1', 'user'))[0]!.note).toBe('天冷');
  });

  it('things the user gives him show up as his, marked', async () => {
    const bread = (await shopApi.products().get('p1'))!;
    await shopApi.buy(bread, { buyer: 'user', to: 'char', characterId: 'ch1', source: 'ui' });
    expect(await volatile(pc())).toContain('你有的东西：黑麦面包（对方送的）、羊毛斗篷');
  });

  it('catchup browse offers the shelf; buying applies with his wallet and notifies; skipped when he just bought', async () => {
    const item = (await collectBrowse(cc))!; // 最近一件是对方送的面包，不算他刚买过
    expect(item.label).toBe('商店');
    expect(item.prompt).toContain('¥88.00');
    expect(item.prompt).toContain('1. 《蜂蜜酒》');
    await item.apply({ act: false, n: 0 }, cc);
    expect(balances.ch1).toBe(88);
    await item.apply({ act: true, n: 1 }, cc);
    expect(balances.ch1).toBe(80);
    expect(notices.at(-1)).toBe('阿一 买了件东西');
    expect(await collectBrowse(cc)).toBeNull(); // 刚买过蜂蜜酒
  });

  it('resolver finds by name, validates quote against the description, refuses unknown', async () => {
    const r = await productResolver.resolve({ type: 'product', title: '《蜂蜜酒》', quote: '酒馆自酿' }, { campaignId: 'cp1', characterIds: ['ch1'] });
    expect(r.card).toMatchObject({ type: 'product', title: '蜂蜜酒', quote: '酒馆自酿', subtitle: '老王铺子 · ¥8.00' });
    expect(r.forModel).toContain('酒馆自酿');
    const bad = await productResolver.resolve({ type: 'product', title: '蜂蜜酒', quote: '编的' }, { campaignId: 'cp1', characterIds: ['ch1'] });
    expect(bad.card.quote).toBeUndefined(); expect(bad.forModel).toContain('已去掉');
    await expect(productResolver.resolve({ type: 'product', title: '飞船' }, { campaignId: 'cp1', characterIds: ['ch1'] })).rejects.toThrow(/shop_browse/);
    expect((await shopApi.products().get('p3'))!.keep).toBe(true);
    const p = (await shopApi.products().get('p2'))!;
    expect(validQuote(' 北方羊毛 ', p)).toBe('北方羊毛');
    expect(buildCard(p).subtype).toBeUndefined();
  });
});

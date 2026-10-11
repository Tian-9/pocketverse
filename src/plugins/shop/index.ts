import { definePlugin, icons, gradients, clock, sanitizeSvg } from '$kernel/api';
import type { PluginContext } from '$kernel/api';
import { ulid } from 'ulid';
import Shop from './Shop.svelte';
import ProductScreen from './Product.svelte';
import OrdersScreen from './Orders.svelte';
import { CATALOG_SYSTEM, catalogUser, catalogSchema, parseCatalog, type CatalogMaterial } from './catalog';
import ShopSection from './ShopSection.svelte';
import { tools, volatile, collectBrowse } from './character';
import { productResolver } from './share';
import ProductPicker from './ProductPicker.svelte';

/**
 * 商店：一局一家店，货架是便宜模型按这个世界生成的，搜什么就有什么。
 * 买东西的钱走钱包插件的 wallet 服务；钱包没开就只能看、只能分享。
 */
export interface Product {
  id: string; campaignId: string;
  name: string; price: number; category: string;
  /** 一两句，分享卡的 excerpt，引用校验的原文 */
  desc: string;
  seller?: string;
  /** 模型画的小图，已经过 sanitizeSvg；只给人看，不回给模型 */
  svg?: string;
  source: 'catalog' | 'search' | 'manual';
  /** 买过或分享过：清理时留下 */
  keep?: boolean;
  createdAt: number;
}

export interface Order {
  id: string; campaignId: string; productId: string;
  /** 快照，商品被清理了订单还在 */
  name: string; price: number;
  buyer: 'user' | 'char'; to: 'user' | 'char';
  /** 这局的他 */
  characterId: string;
  /** 送礼留言 */
  note?: string;
  conversationId?: string;
  source: 'ui' | 'chat' | 'catchup';
  createdAt: number;
  /** 买的时候的剧情时刻（存档时钟）；旧数据没有就当和 createdAt 一样 */
  storyTs?: number;
  /** 留给以后的物流，先不用 */
  deliveredAt?: number;
}

/** 订单的剧情时刻：「刚买过」和显示都按它 */
export const orderAt = (o: Order) => o.storyTs ?? o.createdAt;

/** 钱包插件提供的服务，形状见 plugins/redpacket/index.ts 的 WalletService；这里只声明用到的 */
export interface ShopWallet {
  balance(campaignId: string, ownerId: string): Promise<number>;
  charge(campaignId: string, ownerId: string, amount: number, reason: string): Promise<boolean>;
}

let ctx: PluginContext;
export const SHELF_CATEGORIES = 5;
export const PER_CATEGORY = 5;
export const SEARCH_COUNT = 4;
/** 每存档最多留多少件没人买过的商品 */
export const KEEP_PRODUCTS = 200;
export const yuan = (n: number) => '¥' + n.toFixed(2);
const norm = (s: string) => s.replace(/[《》「」""''\s]/g, '').toLowerCase();

const generating = new Set<string>();

export const shopApi = {
  ctx: () => ctx,
  products: () => ctx.table<Product>('products'),
  orders: () => ctx.table<Order>('orders'),
  wallet: () => ctx.service<ShopWallet>('wallet'),
  lastCampaign: () => ctx.settings.get<string | null>('campaign', null),
  setLastCampaign: (id: string) => ctx.settings.set('campaign', id),
  categories: (campaignId: string) => ctx.settings.get<string[]>(`categories.${campaignId}`, []),
  stockedAt: (campaignId: string) => ctx.settings.get<number>(`stockedAt.${campaignId}`, 0),
  isGenerating: (campaignId: string) => generating.has(campaignId),

  /** 这一局在卖的，新的在前 */
  all(campaignId: string) { return this.products().where('campaignId').equals(campaignId).reverse().sortBy('createdAt'); },

  /** 按名字找：全等优先，再包含；都没有返回 undefined */
  find(products: Product[], name: string): Product | undefined {
    const q = norm(name);
    if (!q) return undefined;
    return products.find((p) => norm(p.name) === q) ?? products.find((p) => norm(p.name).includes(q) || q.includes(norm(p.name)));
  },

  /** 本地搜：名字、描述、分类、商家 */
  match(products: Product[], query: string): Product[] {
    const q = query.trim();
    if (!q) return products;
    return products.filter((p) => [p.name, p.desc, p.category, p.seller ?? ''].some((s) => s.includes(q)));
  },

  /**
   * 生成一批商品落库。mode 见 CatalogMaterial：进货 / 给某分类换一批 / 按关键词搜。
   * 一次一局只跑一个；没配 API Key 或正在跑返回 null。
   */
  async generate(campaignId: string, mode: CatalogMaterial['mode']): Promise<Product[] | null> {
    if (!ctx.llm.configured || generating.has(campaignId)) return null;
    generating.add(campaignId);
    try {
      const cp = await ctx.data.campaign(campaignId);
      if (!cp) return null;
      const [world, dir, mems, categories, existing] = await Promise.all([
        ctx.data.world(cp.worldId), ctx.data.loreDirectory(campaignId), ctx.data.memories(campaignId, { limit: 6, minImportance: 2 }), this.categories(campaignId), this.all(campaignId),
      ]);
      const relevant = mode.kind === 'category' ? existing.filter((p) => p.category === mode.category) : mode.kind === 'search' ? this.match(existing, mode.query) : existing;
      const { text } = await ctx.llm.chat({
        system: CATALOG_SYSTEM,
        user: catalogUser({
          worldName: world?.name ?? cp.worldName, worldSummary: world?.summary ?? '', loreDirectory: dir.slice(0, 3000),
          time: clock.format(cp.now), location: cp.state.location,
          happenings: [...cp.state.facts, ...mems.map((m) => m.text)].slice(0, 10),
          existing: relevant.slice(0, 40).map((p) => p.name), categories, mode,
        }),
        cheap: true, effort: 'low', maxTokens: mode.kind === 'shelf' ? 16000 : 6000, jsonSchema: catalogSchema(),
      });
      const items = parseCatalog(text);
      const now = Date.now();
      const source: Product['source'] = mode.kind === 'search' ? 'search' : 'catalog';
      const out: Product[] = items.map((it, i) => {
        const svg = it.svg ? sanitizeSvg(it.svg) : null;
        return {
          id: ulid(), campaignId, name: it.name, price: it.price, category: mode.kind === 'category' ? mode.category : it.category,
          desc: it.desc, seller: it.seller || undefined, source, createdAt: now + i, ...(svg ? { svg } : {}),
        };
      });
      await this.products().bulkAdd(out);
      // 分类表：新出现的分类追加，顺序稳定
      const cats = [...categories];
      for (const p of out) if (!cats.includes(p.category)) cats.push(p.category);
      if (cats.length !== categories.length) await ctx.settings.set(`categories.${campaignId}`, cats);
      if (mode.kind === 'shelf') await ctx.settings.set(`stockedAt.${campaignId}`, now);
      await this.prune(campaignId);
      return out;
    } finally { generating.delete(campaignId); }
  },

  /** 首次进货：还没货架就生成一次 */
  async stock(campaignId: string) {
    if (await this.stockedAt(campaignId)) return null;
    return this.generate(campaignId, { kind: 'shelf', categories: SHELF_CATEGORIES, perCategory: PER_CATEGORY });
  },

  /** 搜：本地有就本地的，没有就让模型编几件存起来 */
  async search(campaignId: string, query: string): Promise<Product[]> {
    const q = query.trim();
    if (!q) return [];
    const local = this.match(await this.all(campaignId), q);
    if (local.length) return local;
    return (await this.generate(campaignId, { kind: 'search', query: q, count: SEARCH_COUNT })) ?? [];
  },

  /**
   * 买：从 buyer 这局的钱包扣钱，记一条订单。钱包没开抛错；钱不够返回 null，一分不动。
   * buyer 是谁出钱，to 是东西归谁；characterId 是这局的他（买家或收礼的人）。
   */
  async buy(product: Product, o: { buyer: Order['buyer']; to: Order['to']; characterId: string; note?: string; conversationId?: string; source: Order['source'] }): Promise<Order | null> {
    const wallet = this.wallet();
    if (!wallet) throw new Error('钱包插件没开，买不了');
    const owner = o.buyer === 'user' ? 'user' : o.characterId;
    if (!(await wallet.charge(product.campaignId, owner, product.price, `买 ${product.name}`))) return null;
    const order: Order = {
      id: ulid(), campaignId: product.campaignId, productId: product.id, name: product.name, price: product.price,
      buyer: o.buyer, to: o.to, characterId: o.characterId, source: o.source, createdAt: Date.now(), storyTs: (await ctx.data.campaign(product.campaignId))?.now ?? Date.now(),
      ...(o.note ? { note: o.note } : {}), ...(o.conversationId ? { conversationId: o.conversationId } : {}),
    };
    await this.orders().add(order);
    await this.products().update(product.id, { keep: true } as Partial<Product>);
    return order;
  },

  /** 这一局的订单，新的在前；to 指定归谁的 */
  recentOrders(campaignId: string, to?: Order['to'], n = 50) {
    return this.orders().where('campaignId').equals(campaignId).reverse().sortBy('createdAt').then((xs) => (to ? xs.filter((x) => x.to === to) : xs).slice(0, n));
  },

  /** 只留最近 KEEP_PRODUCTS 件没人买过、没分享过的；搜出来的先删 */
  async prune(campaignId: string) {
    const loose = (await this.all(campaignId)).filter((p) => !p.keep);
    const over = loose.length - KEEP_PRODUCTS;
    if (over <= 0) return;
    const victims = [...loose.filter((p) => p.source === 'search').reverse(), ...loose.filter((p) => p.source !== 'search').reverse()].slice(0, over);
    await this.products().bulkDelete(victims.map((p) => p.id));
  },
};

export default definePlugin({
  id: 'shop',
  name: '商店',
  version: '0.4.0',
  description: '这个世界的购物 App：货架按世界生成，搜什么有什么。买东西花钱包里的钱，一局一家店。他也会逛，会给自己买，也会买了送你。',
  app: { screen: Shop, icon: { paths: icons.shop, background: gradients.orange } },
  screens: { product: ProductScreen, orders: OrdersScreen },
  storage: { tables: { products: 'id, campaignId, category, createdAt', orders: 'id, campaignId, createdAt' } },
  profileSections: [{ id: 'things', label: '他的东西', component: ShopSection }],
  shares: [productResolver],
  composerActions: [{ id: 'product', label: '商品', icon: { paths: icons.shop, background: gradients.orange }, component: ProductPicker }],
  promptContributors: [{ id: 'things', volatile }],
  tools,
  catchup: [{ id: 'browse', tier: 'h6', collect: collectBrowse }],
  setup(c) { ctx = c; },
});

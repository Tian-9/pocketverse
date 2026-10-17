/**
 * 他来逛：聊天里的工具（逛、买、送）、补发（逛了逛，可能给自己买一件）、给提示词的易变段（他有的东西）。
 * 这里只拼材料和落库，模型调用都由内核做。
 */
import type { PromptContext, CatchupContext, CatchupItem, ToolDef } from '$kernel/api';
import { shopApi, yuan, orderAt, type Product, type Order } from './index';
import { buildCard } from './share';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
const line = (p: Product, i: number, mine = false) => `${i + 1}. 《${p.name}》 ${yuan(p.price)}${p.seller ? ' · ' + p.seller : ''}${mine ? '（你已经有了）' : ''}\n   ${clip(p.desc.replace(/\s+/g, ' '), 60)}`;

/**
 * 他已经有的（他买的 + 对方送的），按商品 id 和名字都认：店家现找的同名商品是新 id。
 * 「你有的东西」只列最近 12 件，更早的他会忘，所以货架、购买、补发都按这里查，不靠他记得。
 */
export async function ownedBy(campaignId: string): Promise<(p: Product) => boolean> {
  const xs = await shopApi.recentOrders(campaignId, 'char', 1000);
  const ids = new Set(xs.map((o) => o.productId)), names = new Set(xs.map((o) => o.name));
  return (p) => ids.has(p.id) || names.has(p.name);
}

/** 上一次 shop_browse 给他看的列表，shop_buy 按编号从这里取；按对话存，换个对话重新看 */
const listings = new Map<string, Product[]>();
export const lastListing = (conversationId: string) => listings.get(conversationId) ?? [];

/** 货架概览：每个分类前两件 */
async function overview(campaignId: string): Promise<Product[]> {
  const all = await shopApi.all(campaignId);
  const cats = await shopApi.categories(campaignId);
  const out: Product[] = [];
  for (const c of cats) out.push(...all.filter((p) => p.category === c).slice(0, 2));
  for (const p of all) if (out.length < 10 && !out.includes(p)) out.push(p);
  return out.slice(0, 10);
}

/** 他有的东西：他买的 + 你送的，新的在前 */
export const hisThings = (campaignId: string, n = 12) => shopApi.recentOrders(campaignId, 'char', n);
/** 他送过你的 */
export const hisGifts = (campaignId: string, n = 6) => shopApi.recentOrders(campaignId, 'user', 50).then((xs) => xs.filter((o) => o.buyer === 'char').slice(0, n));
const thing = (o: Order) => `${o.name}${o.buyer === 'user' && o.to === 'char' ? '（对方送的）' : ''}`;

export const tools: ToolDef[] = [
  {
    name: 'shop_browse',
    modes: ['online'],
    label: '逛商店',
    description: '逛这个世界的购物 App。不带参数看货架概览（带编号）；带 query 搜商品（没有的店家会现找）；带 n 看某一件的详情。只在聊到买东西、送礼、或者想看看有什么的时候用。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '关键词，可不填' }, n: { type: 'integer', description: '上一次列表里的编号，看这一件' } } },
    async handler(input: unknown, p: PromptContext) {
      const { query, n } = (input ?? {}) as { query?: unknown; n?: unknown };
      if (Number.isInteger(n) && (n as number) >= 1) {
        const it = lastListing(p.conversationId)[(n as number) - 1];
        return it ? `《${it.name}》 ${yuan(it.price)}${it.seller ? ' · ' + it.seller : ''} · ${it.category}\n${it.desc}` : `列表里没有第 ${n} 件。`;
      }
      const q = String(query ?? '').trim();
      const hits = q ? (await shopApi.search(p.campaignId, q)).slice(0, 8) : await overview(p.campaignId);
      listings.set(p.conversationId, hits);
      if (!hits.length) return q ? `店里没有和「${q}」有关的东西。` : '货架还是空的。';
      const mine = await ownedBy(p.campaignId);
      return hits.map((x, i) => line(x, i, mine(x))).join('\n') + '\n\n要买就用 shop_buy 给编号。';
    },
  },
  {
    name: 'shop_buy',
    label: '买东西',
    modes: ['online'],
    description: '买 shop_browse 列表里的第 n 件。给自己买就只给 n；buy_for_them 为 true 是买下送给对方（可附一句 note），对方会直接收到。钱从你自己的钱包扣，不够就买不了。只在真的想买的时候用，一轮最多一次。',
    inputSchema: { type: 'object', properties: { n: { type: 'integer', description: '列表里的编号' }, buy_for_them: { type: 'boolean', description: '送给对方' }, note: { type: 'string', description: '送礼附的一句话' } }, required: ['n'] },
    async handler(input: unknown, p: PromptContext) {
      const { n, buy_for_them, note } = (input ?? {}) as { n?: unknown; buy_for_them?: unknown; note?: unknown };
      const it = lastListing(p.conversationId)[Number(n) - 1];
      if (!it) return '先用 shop_browse 看列表，再按编号买。';
      const gift = !!buy_for_them;
      // 给自己买已经有的：直接拦下（买来送对方不拦）
      if (!gift && (await ownedBy(p.campaignId))(it)) return `你已经有《${it.name}》了，不用再买一样的。想送给对方就用 buy_for_them。`;
      const me = p.characterIds[0]!;
      const msg = String(note ?? '').trim().slice(0, 60);
      let order: Order | null;
      try {
        order = await shopApi.buy(it, { buyer: 'char', to: gift ? 'user' : 'char', characterId: me, conversationId: p.conversationId, source: 'chat', ...(p.sourceId ? { sourceId: p.sourceId } : {}), ...(msg ? { note: msg } : {}) });
      } catch (e) { return e instanceof Error ? e.message : String(e); }
      const wallet = shopApi.wallet();
      const balance = wallet ? await wallet.balance(p.campaignId, me) : 0;
      if (!order) return `你钱包里只有 ${yuan(balance)}，买不起 ${yuan(it.price)} 的《${it.name}》。换便宜的，或者这次别买。`;
      if (gift) {
        p.addCard?.('share', JSON.stringify(buildCard(it, { gift: true, note: msg })), {}, `[买了《${it.name}》送给对方${msg ? '，留言「' + msg + '」' : ''}]`);
        return `已买下《${it.name}》送给对方，卡片在对话里。你钱包里还剩 ${yuan(balance)}。不用再描述礼物本身。`;
      }
      return `已买下《${it.name}》，花了 ${yuan(it.price)}，钱包里还剩 ${yuan(balance)}。`;
    },
  },
];

/** 易变段：他有的东西（状态，每轮都给）和他送过你的，没有就空 */
export async function volatile(p: PromptContext): Promise<string> {
  const [things, gifts] = await Promise.all([hisThings(p.campaignId), hisGifts(p.campaignId)]);
  if (!things.length && !gifts.length) return '';
  const lines = [];
  if (things.length) lines.push(`你有的东西：${things.map(thing).join('、')}`);
  if (gifts.length) lines.push(`你送过对方：${gifts.map((o) => o.name).join('、')}`);
  return `<商店>\n${lines.join('\n')}\n</商店>`;
}

/** 补发 · 逛商店（h6）：看看货架，想买就给自己买一件，不想就算。送礼只在聊天里 */
export async function collectBrowse(c: CatchupContext): Promise<CatchupItem | null> {
  const wallet = shopApi.wallet();
  if (!wallet) return null;
  // 已经有的不摆出来：补发时他看不到自己有什么，摆出来就可能再买一件一样的
  const mine = await ownedBy(c.campaignId);
  const items = (await overview(c.campaignId)).filter((p) => !mine(p));
  if (!items.length) return null;
  const last = (await hisThings(c.campaignId, 1))[0];
  if (last && last.buyer === 'char' && c.to - orderAt(last) < 24 * 3600_000) return null; // 刚买过（按剧情钟）
  const balance = await wallet.balance(c.campaignId, c.characterId);
  return {
    label: '商店',
    prompt: `这${c.elapsedText}你也翻了翻购物 App。货架上有：\n${items.map((p, i) => line(p, i)).join('\n')}\n\n你钱包里有 ${yuan(balance)}。真需要、真想要就给自己买一件（n 填编号），不要为了买而买。不买就 act 填 false。`,
    schema: { type: 'object', additionalProperties: false, required: ['act', 'n'], properties: { act: { type: 'boolean', description: '买不买' }, n: { type: 'integer', description: '买哪一件的编号，不买填 0' } } },
    async apply(out: unknown, cc: CatchupContext) {
      const o = out as { act?: boolean; n?: number } | undefined;
      const it = items[Number(o?.n ?? 0) - 1];
      if (!o?.act || !it) return;
      const order = await shopApi.buy(it, { buyer: 'char', to: 'char', characterId: cc.characterId, source: 'catchup' }).catch(() => null);
      if (order) shopApi.ctx().notify(`${cc.characterName} 买了件东西`, `${it.name} ${yuan(it.price)}`, 'app');
    },
  };
}

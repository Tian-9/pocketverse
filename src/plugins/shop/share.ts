/**
 * 商品当分享卡：他用内核 share 工具分享（type: product），你从「+」面板挑一件发给他；送礼也是同一张卡，subtype 'gift'。
 * 都产出通用 ShareCard，聊天插件用通用卡片渲染，点卡片进商品页。
 */
import type { ShareCard, ShareResolver, ShareQuery, ShareContext } from '$kernel/api';
import { shopApi, yuan, type Product } from './index';

/** quote 必须是描述里的原话，否则丢掉 */
export function validQuote(quote: string | undefined, product: Product): string | undefined {
  const q = quote?.trim();
  return q && product.desc.includes(q) ? q : undefined;
}

export function buildCard(p: Product, opts: { gift?: boolean; note?: string; quote?: string } = {}): ShareCard {
  return {
    type: 'product', ...(opts.gift ? { subtype: 'gift' } : {}),
    title: p.name, subtitle: [p.seller, yuan(p.price)].filter(Boolean).join(' · '),
    // 送礼留言借 quote 那行显示（“天冷，穿上”），不给通用卡片加字段
    excerpt: p.desc, ...(opts.quote ?? opts.note ? { quote: opts.quote ?? opts.note } : {}),
    source: 'shop', open: { pluginId: 'shop', screen: 'product', params: { id: p.id } },
  };
}

/** 给模型看的：名字、价格、商家、描述 */
export const forModel = (p: Product) => `《${p.name}》 ${yuan(p.price)}${p.seller ? ' · ' + p.seller : ''} · ${p.category}\n${p.desc}`;

export const productResolver: ShareResolver = {
  type: 'product',
  label: '商品',
  hint: 'product：商店里的一件商品。title 填商品名（要和 shop_browse 里看到的一致），quote 填想引用的描述原话（可不填）。只是给对方看，不花钱；要买下送人用 shop_buy',
  async resolve(q: ShareQuery, ctx: ShareContext) {
    const p = shopApi.find(await shopApi.all(ctx.campaignId), q.title);
    if (!p) throw new Error(`商店里没有叫《${q.title}》的商品，不要编。先用 shop_browse 搜搜。`);
    const quote = validQuote(q.quote, p);
    await shopApi.products().update(p.id, { keep: true } as Partial<Product>);
    return { card: buildCard(p, { quote }), forModel: forModel(p) + (q.quote && !quote ? '\n\n（你想引的那句不在描述里，已去掉，不要再说）' : '') };
  },
};

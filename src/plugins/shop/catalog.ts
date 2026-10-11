/**
 * 商品生成：一次便宜模型调用，产出一批贴这个世界的商品。
 * 三种用法：进货（首次打开，几个分类各几件）、换一批（指定分类）、搜索（按关键词编几件）。
 * 这里只做纯函数（拼提示词、定 schema、解析结果），不碰库，方便测。
 */

export interface CatalogMaterial {
  worldName: string;
  worldSummary: string;
  /** 条目目录，可以为空 */
  loreDirectory: string;
  /** 剧情时间，没有就用真实时间 */
  time: string;
  location?: string;
  /** 这一局当前事实 + 近期要事 */
  happenings: string[];
  /** 已有的商品名，别重复 */
  existing: string[];
  /** 已有的分类；进货时为空 */
  categories: string[];
  /** 要干什么 */
  mode: { kind: 'shelf'; categories: number; perCategory: number } | { kind: 'category'; category: string; count: number } | { kind: 'search'; query: string; count: number };
}

export interface CatalogItem { category: string; name: string; price: number; desc: string; seller: string; /** 原样的 SVG，入库前要过 sanitizeSvg */ svg?: string }

export const CATALOG_SYSTEM = `你在模拟一个世界里的购物 App 上架的商品。给定这个世界的设定和最近发生的事，写出商品列表。
要求：
- 商品要贴这个世界：古代卖古代的东西，修仙卖丹药法器，现代卖现代的。世界设定里提到的物件、地名、门派、店铺可以直接用。
- 每件商品：名字（短，像真商品名）、价格（数字，按这个世界里普通人的消费水平，有便宜有贵）、一两句描述（像商品详情页，不要营销腔堆砌）、商家名（像这个世界里会有的店名，同一分类里可以是不同店）。
- 分类名两三个字，像 App 里的分类标签。
- 每件商品配一张小图 svg：扁平贴纸风，viewBox="0 0 64 64"，最多 10 个图形，只用 path / rect / circle / ellipse / line / polygon，3 到 4 种平涂颜色，深色粗描边（stroke-width 3，stroke-linejoin round），不要文字、渐变、滤镜、script，背景透明，不要大面积纯白或纯黑。画不出来就留空字符串。
- 不要出现「用户」「角色」「AI」「模型」这些词，不要解释。
- 严格按给定的 JSON 结构输出。`;

const list = (xs: string[], empty: string) => (xs.length ? xs.map((x) => '- ' + x).join('\n') : empty);

export function catalogUser(m: CatalogMaterial): string {
  const parts = [`# 这个世界\n${m.worldName}${m.worldSummary ? '：' + m.worldSummary : ''}`];
  if (m.loreDirectory) parts.push(`# 设定目录（商品可以从这里取材）\n${m.loreDirectory}`);
  parts.push(`# 现在\n时间：${m.time}${m.location ? '\n地点：' + m.location : ''}\n最近发生的事（可以影响在卖什么、什么涨价）：\n${list(m.happenings, '（没什么大事）')}`);
  const md = m.mode;
  if (md.kind === 'shelf') {
    parts.push(`# 任务\n上架 ${md.categories} 个分类，每个分类 ${md.perCategory} 件商品。分类之间不要重叠，覆盖吃穿用玩等日常所需。`);
  } else if (md.kind === 'category') {
    parts.push(`# 任务\n给「${md.category}」分类再上 ${md.count} 件新商品，category 都填「${md.category}」。`);
  } else {
    parts.push(`# 任务\n有人在搜「${md.query}」。给出 ${md.count} 件和它相关、这个世界里买得到的商品。category 从这些分类里选最合适的：${m.categories.length ? m.categories.join('、') : '自己定一个'}。`);
  }
  if (m.existing.length) parts.push(`# 已经在卖的，别重复\n${list(m.existing, '')}`);
  return parts.join('\n\n');
}

export function catalogSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'name', 'price', 'desc', 'seller', 'svg'], properties: {
      category: { type: 'string', description: '分类名，两三个字' }, name: { type: 'string', description: '商品名' },
      price: { type: 'number', description: '价格，数字' }, desc: { type: 'string', description: '一两句描述' }, seller: { type: 'string', description: '商家名' },
      svg: { type: 'string', description: '商品小图，完整的 <svg> 字符串，按风格要求；画不出来留空' },
    } } } },
  };
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** 解析模型输出：丢掉缺字段或价格不对的项，截长度；解析不出来返回空数组而不是抛 */
export function parseCatalog(text: string): CatalogItem[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const items = (raw as { items?: unknown })?.items;
  return (Array.isArray(items) ? items : []).map((x) => {
    const o = x as { category?: unknown; name?: unknown; price?: unknown; desc?: unknown; seller?: unknown; svg?: unknown };
    const price = Math.round(Number(o?.price) * 100) / 100;
    const svg = str(o?.svg, 8192);
    return { category: str(o?.category, 8), name: str(o?.name, 40), price, desc: str(o?.desc, 300), seller: str(o?.seller, 24), ...(svg.startsWith('<svg') ? { svg } : {}) };
  }).filter((p) => p.category && p.name && p.desc && Number.isFinite(p.price) && p.price > 0);
}

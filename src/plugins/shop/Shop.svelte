<script lang="ts">
  /**
   * 商店首页：一局一家店。顶部切存档（只列每张卡当前这一局），分类标签筛，搜索框搜（本地没有就让模型编几件）。
   * 第一次打开没货架就进一次货；每个分类底部能「换一批」。
   */
  import { NavBar, Placeholder, Glyph, Sheet, List, Cell, Button, Picture, live, nav, icons } from '$kernel/api';
  import type { CampaignView } from '$kernel/api';
  import { shopApi, yuan, PER_CATEGORY, type Product } from './index';

  const campaigns = live(() => shopApi.ctx().data.currentCampaigns(), []);
  let selected = $state<string | null>(null);
  $effect(() => {
    const list = campaigns.value;
    if (!list.length) { selected = null; return; }
    if (selected && list.some((c) => c.id === selected)) return;
    shopApi.lastCampaign().then((last) => { selected = list.some((c) => c.id === last) ? last : list[0]!.id; });
  });
  const current = $derived<CampaignView | undefined>(campaigns.value.find((c) => c.id === selected));

  const products = live(() => (selected ? shopApi.all(selected) : Promise.resolve([] as Product[])), [] as Product[], () => [selected]);
  const categories = live(() => (selected ? shopApi.categories(selected) : Promise.resolve([] as string[])), [] as string[], () => [selected, products.value.length]);

  let category = $state<string | null>(null);
  let query = $state('');
  let results = $state<Product[] | null>(null);
  const shown = $derived.by(() => {
    if (results) return results;
    const q = query.trim();
    const base = q ? shopApi.match(products.value, q) : products.value;
    return category ? base.filter((p) => p.category === category) : base;
  });

  let busy = $state(false);
  let notice = $state('');
  // 第一次打开这家店：进货
  $effect(() => {
    const id = selected;
    if (!id) return;
    shopApi.stockedAt(id).then((at) => { if (!at) run(() => shopApi.stock(id), '正在进货…', true); });
  });
  async function run(fn: () => Promise<Product[] | null>, msg: string, auto = false) {
    if (busy) return;
    if (!shopApi.ctx().llm.configured) { if (!auto) shopApi.ctx().notify('进不了货', '先在设置里配置 API Key'); return; }
    busy = true; notice = msg;
    try {
      const r = await fn();
      notice = r ? (r.length ? `上了 ${r.length} 件新货` : '这次没找到合适的货') : '';
    } catch (e) { shopApi.ctx().notify('进货失败', e instanceof Error ? e.message : String(e)); notice = ''; }
    finally { busy = false; setTimeout(() => (notice = ''), 4000); }
  }
  async function search() {
    const id = selected; const q = query.trim();
    if (!id || !q) { results = null; return; }
    const local = shopApi.match(products.value, q);
    if (local.length) { results = null; return; }
    await run(async () => { const r = await shopApi.search(id, q); results = r; return r; }, `正在找「${q}」…`);
  }
  function clearSearch() { query = ''; results = null; }
  const refill = (id: string, cat: string) => run(() => shopApi.generate(id, { kind: 'category', category: cat, count: PER_CATEGORY }), `「${cat}」正在上新…`);

  let picking = $state(false);
  async function pick(c: CampaignView) { selected = c.id; category = null; clearSearch(); picking = false; await shopApi.setLastCampaign(c.id); }
</script>

<NavBar title="商店" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => selected && nav.push('shop', 'orders', { campaignId: selected })} aria-label="订单" disabled={!selected}><Glyph paths={icons.receipt} size={22} color="var(--tint)" width={2} /></button>
  {/snippet}
</NavBar>

{#if current}
  <button class="where" onclick={() => (picking = true)} aria-label="切换存档">
    <span class="w">{current.worldName}</span><span class="dot">·</span><span>{current.characterName}</span><span class="chev">⌄</span>
  </button>
  <div class="search">
    <input bind:value={query} placeholder="搜点什么，没有的会现找" oninput={() => { results = null; category = null; }} onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); search(); } }} />
    {#if query}<button class="clear" onclick={clearSearch} aria-label="清除">×</button>{/if}
  </div>
  {#if categories.value.length && !results}
    <div class="cats">
      <button class="cat" class:on={category === null} onclick={() => (category = null)}>全部</button>
      {#each categories.value as c (c)}<button class="cat" class:on={category === c} onclick={() => (category = category === c ? null : c)}>{c}</button>{/each}
    </div>
  {/if}
{/if}
{#if notice}<div class="notice">{notice}</div>{/if}

{#if !current}
  <Placeholder title="还没有商店" body="先和一个角色聊一句，他所在的世界就有商店了。" paths={icons.shop} />
{:else if shown.length === 0}
  <Placeholder title={query.trim() ? '没有这样的货' : '货架是空的'} body={busy ? notice : query.trim() ? '按回车让店家找找。' : '进货要用模型，先在设置里配置 API Key。'} paths={icons.shop} />
{:else}
  <div class="grid">
    {#each shown as p (p.id)}
      <button class="item" onclick={() => nav.push('shop', 'product', { id: p.id })}>
        <div class="pic"><Picture svg={p.svg} size="100%" radius="8px" fallback={icons.shop} /></div>
        <div class="name">{p.name}</div>
        <div class="seller">{p.seller ?? p.category}</div>
        <div class="price">{yuan(p.price)}</div>
      </button>
    {/each}
  </div>
  {#if category && !results && !query.trim()}
    <div class="more"><Button kind="tinted" onclick={() => selected && refill(selected, category!)} disabled={busy}>{busy ? '上新中…' : `「${category}」换一批`}</Button></div>
  {/if}
{/if}
<div style="height:40px"></div>

<Sheet bind:open={picking} title="逛哪个世界的商店">
  <List>
    {#each campaigns.value as c (c.id)}<Cell title={c.worldName} subtitle={c.characterName} onclick={() => pick(c)} />{/each}
  </List>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .where { display: flex; align-items: center; gap: 6px; margin: 0 16px 8px; font-size: 14px; color: var(--label-2); }
  .where .w { color: var(--label); font-weight: 600; }
  .where .chev { margin-left: 2px; }
  .search { position: relative; margin: 0 16px 8px; }
  .search input { width: 100%; padding: 8px 32px 8px 12px; border-radius: 10px; background: var(--fill-2); font-size: 15px; }
  .search .clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; border-radius: 12px; color: var(--label-2); font-size: 18px; line-height: 1; }
  .cats { display: flex; gap: 8px; padding: 0 16px 10px; overflow-x: auto; scrollbar-width: none; }
  .cat { flex: none; font-size: 13px; padding: 5px 12px; border-radius: 14px; background: var(--fill-2); color: var(--label-2); }
  .cat.on { background: var(--tint); color: #fff; }
  .notice { margin: 0 16px 8px; font-size: 13px; color: var(--label-2); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 16px; }
  .item { text-align: left; background: var(--bg-surface); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
  .item:active { background: var(--fill-2); }
  .pic { height: 96px; margin-bottom: 6px; }
  .pic :global(.picture) { height: 96px; }
  .name { font-size: 14px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .seller { font-size: 12px; color: var(--label-3); }
  .price { font-size: 15px; font-weight: 700; color: var(--orange, #ff7a00); margin-top: 2px; }
  .more { display: flex; justify-content: center; margin: 14px 16px 0; }
</style>

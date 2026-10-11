<script lang="ts">
  /** 「+」面板 → 商品：挑这一局商店里的一件，发给他看，或者买下送给他（扣你的钱包） */
  import { List, Cell, Button, Field, ShareCardView, live } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  import { shopApi, yuan, type Product } from './index';
  import { buildCard, forModel } from './share';
  let { conversationId, campaignId, characterId, onsend, onclose }: ComposerActionProps = $props();
  const products = live(() => shopApi.all(campaignId), [] as Product[], () => [campaignId]);
  let query = $state('');
  let found = $state<Product[] | null>(null);
  const shown = $derived(found ?? shopApi.match(products.value, query).slice(0, 30));
  let picked = $state<Product | null>(null);
  let note = $state('');
  let busy = $state(false);
  let balance = $state<number | null>(null);
  const wallet = shopApi.wallet();
  $effect(() => { if (picked && wallet) wallet.balance(campaignId, 'user').then((b) => (balance = b)); });

  async function search() {
    const q = query.trim();
    if (!q || busy) return;
    if (shopApi.match(products.value, q).length) { found = null; return; }
    if (!shopApi.ctx().llm.configured) { shopApi.ctx().notify('找不了', '先在设置里配置 API Key'); return; }
    busy = true;
    try { found = await shopApi.search(campaignId, q); }
    catch (e) { shopApi.ctx().notify('没找到', e instanceof Error ? e.message : String(e)); }
    finally { busy = false; }
  }
  async function show() {
    const p = picked; if (!p) return;
    await shopApi.products().update(p.id, { keep: true } as Partial<Product>);
    onsend({ text: `[分享了一件商品给你看]\n${forModel(p)}`, cards: [{ tag: 'share', body: JSON.stringify(buildCard(p)), alt: `[商品] ${p.name}` }], cardOnly: true });
  }
  async function gift() {
    const p = picked; if (!p || busy) return;
    busy = true;
    try {
      const msg = note.trim().slice(0, 60);
      const order = await shopApi.buy(p, { buyer: 'user', to: 'char', characterId, conversationId, source: 'ui', ...(msg ? { note: msg } : {}) });
      if (!order) { shopApi.ctx().notify('钱不够', `你这局只有 ${yuan(balance ?? 0)}`); return; }
      onsend({
        text: `[买了《${p.name}》（${yuan(p.price)}）送给你${msg ? '，留言「' + msg + '」' : ''}]\n${forModel(p)}`,
        cards: [{ tag: 'share', body: JSON.stringify(buildCard(p, { gift: true, note: msg })), alt: `[送了《${p.name}》]${msg ? ' ' + msg : ''}` }], cardOnly: true,
      });
    } catch (e) { shopApi.ctx().notify('没买成', e instanceof Error ? e.message : String(e)); }
    finally { busy = false; }
  }
</script>

{#if !picked}
  <div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); search(); } }} role="presentation">
    <List footer="发给他看不花钱；买下送他从你这局的钱包扣。">
      <Field bind:value={query} placeholder="搜商品，没有的按回车让店家找" oninput={() => (found = null)} />
    </List>
  </div>
  <List>
    {#each shown as p (p.id)}
      <Cell title={p.name} subtitle={[p.seller, p.category].filter(Boolean).join(' · ')} value={yuan(p.price)} onclick={() => (picked = p)} />
    {:else}
      <Cell title={busy ? '店家正在找…' : query.trim() ? '店里没有这个' : '这一局的商店还没进货'} subtitle={query.trim() && !busy ? '点下面「让店家找找」' : undefined} />
    {/each}
  </List>
  <div class="actions">
    {#if query.trim() && !shown.length}<Button kind="tinted" onclick={search} disabled={busy}>{busy ? '找着呢…' : '让店家找找'}</Button>{/if}
    <Button kind="plain" onclick={onclose}>取消</Button>
  </div>
{:else}
  <div class="preview"><ShareCardView body={JSON.stringify(buildCard(picked, { gift: true, note: note.trim() || undefined }))} /></div>
  <List footer={wallet ? `买下送他要 ${yuan(picked.price)}${balance === null ? '' : '，你这局有 ' + yuan(balance)}。` : '钱包插件没开，只能发给他看。'}>
    <Field label="留言" bind:value={note} placeholder="送礼附一句，可不填" />
  </List>
  <div class="actions">
    <Button onclick={gift} disabled={busy || !wallet || (balance !== null && balance < picked.price)}>{busy ? '付款中…' : '买下送给他'}</Button>
    <Button kind="tinted" onclick={show}>只发给他看</Button>
    <Button kind="plain" onclick={() => (picked = null)}>换一件</Button>
  </div>
{/if}

<style>
  .preview { display: flex; justify-content: center; margin: 12px 16px 0; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

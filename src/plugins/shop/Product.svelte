<script lang="ts">
  /** 商品页：名字、价格、商家、描述，「购买」从你这局的钱包扣钱。从分享卡点进来也是这页。 */
  import { NavBar, Placeholder, Button, List, Cell, Picture, live, icons } from '$kernel/api';
  import { shopApi, yuan, type Product } from './index';

  let { id }: { id: string } = $props();
  const product = live(() => shopApi.products().get(id), undefined as Product | undefined, () => [id]);
  const campaign = live(() => (product.value ? shopApi.ctx().data.campaign(product.value.campaignId) : Promise.resolve(undefined)), undefined, () => [product.value?.campaignId]);
  const wallet = shopApi.wallet();
  let balance = $state<number | null>(null);
  let bought = $state(0);
  $effect(() => { const p = product.value; if (p && wallet) wallet.balance(p.campaignId, 'user').then((b) => (balance = b)); });
  const orders = live(() => shopApi.orders().where('campaignId').equals(product.value?.campaignId ?? '').filter((o) => o.productId === id).count(), 0, () => [id, product.value?.campaignId, bought]);

  let busy = $state(false);
  async function buy() {
    const p = product.value; const cp = campaign.value;
    if (!p || !cp || busy) return;
    busy = true;
    try {
      const order = await shopApi.buy(p, { buyer: 'user', to: 'user', characterId: cp.characterId, source: 'ui' });
      if (!order) { shopApi.ctx().notify('钱不够', `你这局只有 ${yuan(balance ?? 0)}`); return; }
      bought++;
      if (wallet) balance = await wallet.balance(p.campaignId, 'user');
      shopApi.ctx().notify('买好了', `${p.name} ${yuan(p.price)}`);
    } catch (e) { shopApi.ctx().notify('没买成', e instanceof Error ? e.message : String(e)); }
    finally { busy = false; }
  }
</script>

<NavBar title="商品" back="商店" />

{#if !product.value}
  <Placeholder title="商品下架了" body="可能被清理了。" paths={icons.shop} />
{:else}
  {@const p = product.value}
  <div class="hero">
    <div class="pic"><Picture svg={p.svg} size={140} radius="20px" fallback={icons.shop} alt={p.name} /></div>
    <div class="price">{yuan(p.price)}</div>
    <h2 class="name">{p.name}</h2>
    <div class="meta">{[p.seller, p.category].filter(Boolean).join(' · ')}</div>
  </div>
  <List footer={wallet ? `钱从你这局的钱包扣${balance === null ? '' : '，余额 ' + yuan(balance)}。` : '钱包插件没开，只能看。'}>
    <Cell title="详情" subtitle={p.desc} />
    {#if orders.value}<Cell title="已买" value={`${orders.value} 次`} />{/if}
  </List>
  <div class="actions">
    <Button onclick={buy} disabled={busy || !wallet || (balance !== null && balance < p.price)}>{busy ? '付款中…' : `购买 ${yuan(p.price)}`}</Button>
  </div>
{/if}

<style>
  .hero { background: var(--bg-surface); padding: 20px 16px 14px; text-align: center; }
  .pic { display: flex; justify-content: center; margin-bottom: 12px; }
  .price { font-size: 24px; font-weight: 700; color: var(--orange, #ff7a00); }
  .name { margin: 4px 0 0; font-size: 18px; font-weight: 600; line-height: 1.35; }
  .meta { margin-top: 4px; font-size: 13px; color: var(--label-3); }
  .actions { display: flex; justify-content: center; margin: 16px; }
</style>

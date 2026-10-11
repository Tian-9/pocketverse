<script lang="ts">
  /** 订单：这一局里买过的东西，新的在前。who 指定只看谁的（归你的 / 归他的）。 */
  import { NavBar, Placeholder, List, Cell, live, nav, icons } from '$kernel/api';
  import type { Order } from './index';
  import { shopApi, yuan } from './index';

  let { campaignId, who }: { campaignId: string; who?: Order['to'] } = $props();
  const orders = live(() => shopApi.recentOrders(campaignId, who), [] as Order[], () => [campaignId, who]);
  const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function line(o: Order) {
    const whose = o.buyer === o.to ? (o.buyer === 'user' ? '你买的' : '他买的') : o.buyer === 'user' ? '你送他的' : '他送你的';
    return [fmt(o.createdAt), whose, o.note ? '「' + o.note + '」' : ''].filter(Boolean).join(' · ');
  }
</script>

<NavBar title={who === 'char' ? '他的东西' : '订单'} back="返回" />

{#if !orders.value.length}
  <Placeholder title="还没买过东西" body="去商店逛逛。" paths={icons.receipt} />
{:else}
  <List>
    {#each orders.value as o (o.id)}
      <Cell title={o.name} subtitle={line(o)} value={yuan(o.price)} onclick={() => nav.push('shop', 'product', { id: o.productId })} />
    {/each}
  </List>
{/if}

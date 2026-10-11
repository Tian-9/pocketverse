<script lang="ts">
  /** 角色主页上的商店段：他有的东西（他买的 + 你送的），和提示词里那行是同一个查询。点进去看全部 */
  import { List, Cell, live, nav } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { hisThings } from './character';
  import { orderAt, type Order } from './index';
  let { campaignId }: ProfileSectionProps = $props();
  const things = live(() => hisThings(campaignId, 5), [] as Order[], () => [campaignId]);
  const when = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
</script>

<List>
  {#each things.value as o (o.id)}
    <Cell title={o.name} subtitle={`${when(orderAt(o))} · ${o.buyer === 'user' ? '你送的' : '他买的'}`} onclick={() => nav.push('shop', 'product', { id: o.productId })} />
  {:else}
    <Cell title="他还没有买过东西" subtitle="聊天里他可能会逛商店，你也可以送他" />
  {/each}
  {#if things.value.length}<Cell title="全部" chevron onclick={() => nav.push('shop', 'orders', { campaignId, who: 'char' })} />{/if}
</List>

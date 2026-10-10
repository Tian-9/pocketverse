<script lang="ts">
  /** 聊天里的转账卡片。body 是 {id}；状态从表里实时取。他转给你的，点「收款」到账，点「退还」退回去 */
  import { live } from '$kernel/storage/live.svelte';
  import { redpacketApi, yuan, isPending, type Packet } from './index';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
  const id = $derived.by(() => { try { return String(JSON.parse(body).id ?? ''); } catch { return ''; } });
  const packet = live(() => redpacketApi.packets().get(id), undefined as Packet | undefined, () => [id]);
  const p = $derived(packet.value);
  const pending = $derived(!!p && isPending(p));
  const status = $derived.by(() => {
    if (!p) return '';
    if (p.refundedAt) return p.from === 'char' ? '已退还' : '他退回来了';
    if (p.openedAt) return p.from === 'char' ? '已收款' : '他已收款';
    return p.from === 'char' ? '待你收款' : '等他收款';
  });
</script>

<div class="tf" class:done={!pending}>
  <div class="top">
    <span class="mark">{p?.refundedAt ? '↩' : pending ? '¥' : '✓'}</span>
    <div class="t">
      <div class="amt">{p ? yuan(p.amount) : '转账'}</div>
      <div class="st">{p?.note ? `${p.note} · ` : ''}{status}</div>
    </div>
  </div>
  {#if p && pending && p.from === 'char'}
    <div class="acts">
      <button onclick={() => redpacketApi.open(p.id)}>收款</button>
      <button class="minor" onclick={() => redpacketApi.refund(p.id)}>退还</button>
    </div>
  {/if}
  <div class="foot">转账</div>
</div>

<style>
  .tf { width: 230px; border-radius: 10px; overflow: hidden; text-align: left; background: #f59a23; color: #fff; }
  .tf.done { background: #f9d3a3; }
  .top { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px; }
  .mark { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.3); display: grid; place-items: center; font-weight: 700; font-size: 18px; flex: 0 0 auto; }
  .t { min-width: 0; }
  .amt { font-size: 17px; font-weight: 600; }
  .st { font-size: 12px; opacity: 0.9; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acts { display: flex; border-top: 0.5px solid rgba(255,255,255,0.4); }
  .acts button { flex: 1; padding: 8px 0; font-size: 14px; font-weight: 600; color: #fff; }
  .acts button + button { border-left: 0.5px solid rgba(255,255,255,0.4); }
  .acts .minor { font-weight: 400; opacity: 0.9; }
  .foot { font-size: 11px; padding: 5px 12px; background: rgba(255,255,255,0.18); }
</style>

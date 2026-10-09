<script lang="ts">
  /** 聊天里的红包卡片。body 是 {id}；状态从表里实时取。 */
  import { live } from '$kernel/storage/live.svelte';
  import { redpacketApi, yuan, type Packet } from './index';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
  const id = $derived.by(() => { try { return String(JSON.parse(body).id ?? ''); } catch { return ''; } });
  const packet = live(() => redpacketApi.packets().get(id), undefined as Packet | undefined, () => [id]);
  const p = $derived(packet.value);
  const canOpen = $derived(!!p && p.from === 'char' && !p.openedAt);
  async function open() { if (canOpen && p) await redpacketApi.open(p.id); }
</script>

<button class="rp" class:opened={!!p?.openedAt} onclick={open} disabled={!canOpen}>
  <div class="top">
    <span class="coin">{p?.openedAt ? yuan(p.amount) : '￥'}</span>
    <div class="t">
      <div class="note">{p?.note ?? '红包'}</div>
      <div class="st">{!p ? '' : p.from === 'char' ? (p.openedAt ? '已领取' : '点击领取') : (p.openedAt ? '已被领取' : '等他领取')}</div>
    </div>
  </div>
  <div class="foot">红包</div>
</button>

<style>
  .rp { width: 230px; border-radius: 10px; overflow: hidden; text-align: left; background: #fa9d3b; color: #fff; }
  .rp.opened { background: #fbd6a7; }
  .top { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px; }
  .coin { width: 40px; height: 40px; border-radius: 50%; background: #ffe9b8; color: #c75c22; display: grid; place-items: center; font-weight: 700; font-size: 14px; flex: 0 0 auto; }
  .t { min-width: 0; }
  .note { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { font-size: 12px; opacity: 0.85; margin-top: 2px; }
  .foot { font-size: 11px; padding: 5px 12px; background: rgba(255,255,255,0.18); }
  .opened .coin { background: #fff3dc; }
</style>

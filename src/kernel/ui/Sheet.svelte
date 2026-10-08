<script lang="ts">
  import type { Snippet } from 'svelte';
  import { nav } from '../nav/nav.svelte';
  let { open = $bindable(false), title, children, onclose }: { open?: boolean; title?: string; children: Snippet; onclose?: () => void } = $props();
  let token: number | null = null;
  // 打开时登记到导航栈，系统返回手势会先关弹窗；关闭时注销
  $effect(() => {
    if (open && token === null) {
      token = nav.openOverlay(() => { token = null; open = false; onclose?.(); });
    } else if (!open && token !== null) {
      const t = token; token = null;
      nav.closeOverlay(t);
    }
  });
  function close() { open = false; onclose?.(); }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>
  <div class="sheet" role="dialog" aria-label={title}>
    <div class="grab"></div>
    {#if title}<h2>{title}</h2>{/if}
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); z-index: 20; animation: fade 0.2s; }
  .sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 21; background: var(--bg-grouped); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; box-shadow: var(--shadow-sheet); max-height: 85%; display: flex; flex-direction: column; padding-bottom: calc(var(--safe-bottom) + 12px); animation: up 0.28s cubic-bezier(0.2, 0.9, 0.3, 1); }
  .grab { width: 36px; height: 5px; border-radius: 3px; background: var(--label-3); margin: 6px auto 8px; }
  h2 { font-size: 17px; font-weight: 600; margin: 4px 16px 10px; text-align: center; }
  .body { overflow-y: auto; flex: 1; }
  @keyframes fade { from { opacity: 0 } }
  @keyframes up { from { transform: translateY(100%) } }
  @media (prefers-reduced-motion: reduce) { .backdrop, .sheet { animation: none } }
</style>

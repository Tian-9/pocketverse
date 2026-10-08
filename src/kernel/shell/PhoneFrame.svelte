<script lang="ts">
  /** 桌面浏览器里的手机外框。手机上不渲染这一层。 */
  import type { Snippet } from 'svelte';
  import { theme } from '../theme/theme.svelte';
  let { children }: { children: Snippet } = $props();
  let time = $state(fmt());
  function fmt() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  $effect(() => { const t = setInterval(() => (time = fmt()), 10_000); return () => clearInterval(t); });
</script>

<div class="stage">
  <div class="phone">
    <div class="status" class:dark={theme.isDark}>
      <span class="time">{time}</span>
      <span class="island"></span>
      <span class="right">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="0.8"/><rect x="5" y="5.5" width="3" height="6.5" rx="0.8"/><rect x="10" y="3" width="3" height="9" rx="0.8"/><rect x="15" y="0" width="3" height="12" rx="0.8"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.5a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM4.6 7.6a4.8 4.8 0 0 1 6.8 0l-1.1 1.1a3.3 3.3 0 0 0-4.6 0zM1.6 4.6a9 9 0 0 1 12.8 0l-1.1 1.1a7.5 7.5 0 0 0-10.6 0z"/></svg>
        <span class="batt"><span></span></span>
      </span>
    </div>
    <div class="content">{@render children()}</div>
    <div class="indicator" class:dark={theme.isDark}></div>
  </div>
</div>

<style>
  .stage { min-height: 100%; display: grid; place-items: center; background: #0e0e10; padding: 24px; }
  .phone { position: relative; width: 393px; height: 852px; max-height: calc(100vh - 48px); border-radius: 54px; overflow: hidden; box-shadow: 0 0 0 11px #1a1a1c, 0 0 0 13px #3b3b3f, 0 40px 100px rgba(0,0,0,0.6); background: #000; }
  .content { position: absolute; inset: 0; }
  .content :global(.shell) { --safe-top: 54px; --safe-bottom: 24px; }
  .status { position: absolute; top: 0; left: 0; right: 0; height: 54px; z-index: 60; display: flex; align-items: center; justify-content: space-between; padding: 14px 30px 0; color: #000; font-weight: 600; font-size: 16px; pointer-events: none; font-variant-numeric: tabular-nums; }
  .status.dark { color: #fff; }
  .island { position: absolute; left: 50%; top: 11px; transform: translateX(-50%); width: 125px; height: 36px; border-radius: 20px; background: #000; }
  .right { display: inline-flex; align-items: center; gap: 6px; }
  .batt { width: 27px; height: 13px; border: 1.5px solid currentColor; border-radius: 4px; padding: 1.5px; opacity: 0.9; display: inline-block; }
  .batt span { display: block; width: 80%; height: 100%; background: currentColor; border-radius: 2px; }
  .indicator { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); width: 140px; height: 5px; border-radius: 3px; background: #000; z-index: 60; pointer-events: none; }
  .indicator.dark { background: #fff; }
</style>

<script lang="ts">
  import { registry } from '../registry/registry.svelte';
  import { nav } from '../nav/nav.svelte';
  import AppIcon from './AppIcon.svelte';
  let { onedit }: { onedit: () => void } = $props();
  const slots = $derived(registry.resolveDock());
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  function down() { pressTimer = setTimeout(onedit, 500); }
  function up() { clearTimeout(pressTimer); }
</script>

<div class="dock" onpointerdown={down} onpointerup={up} onpointerleave={up} onpointercancel={up} oncontextmenu={(e) => { e.preventDefault(); onedit(); }} role="group" aria-label="Dock">
  {#each slots as s, i (i)}
    {#if s}
      <AppIcon spec={s.icon ?? { paths: [], background: 'var(--fill)' }} label={s.label} showLabel={false} onclick={() => nav.push(s.pluginId, s.screen, s.params)} />
    {:else}
      <button class="empty" aria-label="空位" onclick={onedit}></button>
    {/if}
  {/each}
</div>

<style>
  .dock { margin: 0 12px; padding: 14px 10px; border-radius: 32px; background: var(--dock-bg); backdrop-filter: blur(var(--glass-blur)) saturate(1.6); -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.6); display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; align-items: center; user-select: none; -webkit-user-select: none; }
  .empty { width: 60px; height: 60px; border-radius: var(--radius-icon); background: rgba(255,255,255,0.18); border: 1px dashed rgba(255,255,255,0.5); justify-self: center; }
</style>

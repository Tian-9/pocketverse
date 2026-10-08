<script lang="ts">
  import { nav } from '../nav/nav.svelte';
  import { registry } from '../registry/registry.svelte';
  import Placeholder from '../ui/Placeholder.svelte';
  import NavBar from '../ui/NavBar.svelte';

  function resolve(pluginId: string, screen: string) {
    const p = registry.get(pluginId);
    if (!p) return null;
    if (screen === 'app') return p.app?.screen ?? null;
    return p.screens?.[screen] ?? null;
  }
</script>

{#each nav.stack as entry, i (i)}
  {@const Screen = resolve(entry.pluginId, entry.screen)}
  <section class="screen" style="z-index:{10 + i}">
    {#if Screen}
      <Screen {...entry.params} />
    {:else}
      <NavBar title="找不到界面" />
      <Placeholder title="界面不存在" body="{entry.pluginId} 没有名为 {entry.screen} 的界面。" />
    {/if}
  </section>
{/each}

<style>
  .screen { position: absolute; inset: 0; background: var(--bg-grouped); color: var(--label); display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; animation: push 0.32s cubic-bezier(0.2, 0.9, 0.3, 1); overscroll-behavior: contain; }
  @keyframes push { from { transform: translateX(100%) } }
  @media (prefers-reduced-motion: reduce) { .screen { animation: none } }
</style>

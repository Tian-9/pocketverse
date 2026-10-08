<script lang="ts">
  import { bus } from '../bus/bus';
  import { nav } from '../nav/nav.svelte';
  import { registry } from '../registry/registry.svelte';
  import Icon from '../ui/Icon.svelte';
  import type { KernelEvents } from '../api/types';
  let current = $state<KernelEvents['notify'] | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  bus.on('notify', (n) => {
    current = n;
    clearTimeout(timer);
    timer = setTimeout(() => (current = null), 4000);
  });
  function open() {
    if (current?.pluginId) nav.push(current.pluginId, current.screen ?? 'app');
    current = null;
  }
  const icon = $derived(current?.pluginId ? registry.get(current.pluginId)?.app?.icon : undefined);
</script>

{#if current}
  <button class="banner" onclick={open}>
    {#if icon}<Icon spec={icon} size={32} radius="8px" shadow={false} />{/if}
    <span class="text">
      <span class="t">{current.title}</span>
      {#if current.body}<span class="b">{current.body}</span>{/if}
    </span>
  </button>
{/if}

<style>
  .banner { position: absolute; top: calc(var(--safe-top) + 8px); left: 8px; right: 8px; z-index: 50; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 20px; background: color-mix(in srgb, var(--bg-elevated) 85%, transparent); backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); box-shadow: 0 8px 30px rgba(0,0,0,0.18); color: var(--label); text-align: left; animation: drop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.1); }
  .text { display: flex; flex-direction: column; min-width: 0; }
  .t { font-size: 15px; font-weight: 600; }
  .b { font-size: 14px; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @keyframes drop { from { transform: translateY(-120%) } }
</style>

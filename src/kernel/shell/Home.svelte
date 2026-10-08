<script lang="ts">
  import { registry } from '../registry/registry.svelte';
  import { nav } from '../nav/nav.svelte';
  import AppIcon from './AppIcon.svelte';
  import Dock from './Dock.svelte';
  import DockEditor from './DockEditor.svelte';
  let editing = $state(false);
</script>

<div class="home">
  <div class="grid">
    {#each registry.apps as p (p.id)}
      <AppIcon spec={p.app!.icon} label={p.name} badge={p.app!.badge?.() ?? 0} onclick={() => nav.push(p.id, 'app')} />
    {/each}
  </div>
  <div class="dots" aria-hidden="true"><span class="on"></span><span></span></div>
  <Dock onedit={() => (editing = true)} />
</div>
<DockEditor bind:open={editing} />

<style>
  .home { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--wall); padding-top: calc(var(--safe-top) + 16px); padding-bottom: calc(var(--safe-bottom) + 14px); }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 96px; gap: 6px 8px; padding: 8px 22px; align-content: start; }
  .dots { display: flex; justify-content: center; gap: 8px; padding: 6px 0 12px; }
  .dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--wall-label); opacity: 0.3; }
  .dots span.on { opacity: 0.9; }
</style>

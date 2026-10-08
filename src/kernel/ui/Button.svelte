<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, onclick, kind = 'filled', disabled = false }: { children: Snippet; onclick?: () => void; kind?: 'filled' | 'tinted' | 'plain'; disabled?: boolean } = $props();
</script>

<button class="btn {kind}" {onclick} {disabled} onpointerdown={(e) => e.preventDefault()}>{@render children()}</button>

<style>
  .btn { font-size: 17px; font-weight: 600; border-radius: 12px; padding: 13px 20px; width: 100%; transition: opacity 0.15s; }
  .btn:active { opacity: 0.7; }
  .btn:disabled { opacity: 0.4; }
  .filled { background: var(--tint); color: var(--tint-fg); }
  .tinted { background: color-mix(in srgb, var(--tint) 15%, transparent); color: var(--tint); }
  .plain { background: transparent; color: var(--tint); padding: 8px; width: auto; font-weight: 400; }
</style>

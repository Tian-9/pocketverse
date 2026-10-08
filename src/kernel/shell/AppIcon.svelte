<script lang="ts">
  import type { IconSpec } from '../api/types';
  import Icon from '../ui/Icon.svelte';
  let { spec, label, badge = 0, onclick, showLabel = true, size = 60 }: { spec: IconSpec; label: string; badge?: number; onclick?: () => void; showLabel?: boolean; size?: number } = $props();
</script>

<button class="app" {onclick} aria-label={label}>
  <span class="wrap">
    <Icon {spec} {size} />
    {#if badge > 0}<span class="badge">{badge > 99 ? '99+' : badge}</span>{/if}
  </span>
  {#if showLabel}<span class="label">{label}</span>{/if}
</button>

<style>
  .app { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 4px 0; width: 100%; transition: transform 0.1s; -webkit-touch-callout: none; }
  .app:active { transform: scale(0.92); }
  .wrap { position: relative; display: inline-block; }
  .badge { position: absolute; top: -6px; right: -8px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--red); color: #fff; font-size: 13px; font-weight: 500; display: grid; place-items: center; border: 2px solid transparent; font-variant-numeric: tabular-nums; }
  .label { font-size: 11px; color: var(--wall-label); text-shadow: var(--wall-label-shadow); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
</style>

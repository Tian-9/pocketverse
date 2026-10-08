<script lang="ts">
  import type { IconSpec } from '../api/types';
  let { spec, size = 60, radius = 'var(--radius-icon)', shadow = true }: { spec: IconSpec; size?: number; radius?: string; shadow?: boolean } = $props();
  const stroke = $derived(spec.mode !== 'fill');
</script>

<span class="icon" class:shadow style="width:{size}px;height:{size}px;border-radius:{radius};background:{spec.background}">
  <svg viewBox="0 0 24 24" style="width:{size * 0.52}px;height:{size * 0.52}px" fill={stroke ? 'none' : '#fff'} stroke={stroke ? '#fff' : 'none'} stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#each spec.paths as d}<path {d} />{/each}
  </svg>
</span>

<style>
  .icon { display: inline-grid; place-items: center; flex: 0 0 auto; overflow: hidden; }
  .icon.shadow { box-shadow: var(--shadow-icon); }
</style>

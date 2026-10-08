<script lang="ts">
  import Glyph from './Glyph.svelte';
  let { title, body, paths }: { title: string; body?: string; paths?: string[] } = $props();
</script>

<div class="ph">
  {#if paths}<Glyph {paths} size={44} color="var(--label-3)" width={1.5} />{/if}
  <h3>{title}</h3>
  {#if body}<p>{body}</p>{/if}
</div>

<style>
  .ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 60px 32px; color: var(--label-2); }
  h3 { font-size: 20px; font-weight: 600; color: var(--label); margin: 8px 0 0; }
  p { font-size: 15px; margin: 0; line-height: 1.45; max-width: 28em; }
</style>

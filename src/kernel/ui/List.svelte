<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, footer }: { children: Snippet; footer?: string } = $props();
</script>

<div class="list">{@render children()}</div>
{#if footer}<p class="footer">{footer}</p>{/if}

<style>
  .list { background: var(--bg-surface); border-radius: var(--radius-cell); overflow: hidden; margin: 0 16px; }
  .footer { font-size: 13px; color: var(--label-2); margin: 8px 32px 0; line-height: 1.4; }
</style>

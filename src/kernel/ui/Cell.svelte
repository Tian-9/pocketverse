<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconSpec } from '../api/types';
  import Icon from './Icon.svelte';
  import Glyph from './Glyph.svelte';
  import { icons } from './icons';
  let {
    title, subtitle, icon, value, chevron = false, onclick, right, disabled = false,
  }: { title: string; subtitle?: string; icon?: IconSpec; value?: string; chevron?: boolean; onclick?: () => void; right?: Snippet; disabled?: boolean } = $props();
</script>

{#snippet inner()}
  {#if icon}<Icon spec={icon} size={30} radius="7px" shadow={false} />{/if}
  <div class="text">
    <div class="title">{title}</div>
    {#if subtitle}<div class="subtitle">{subtitle}</div>{/if}
  </div>
  {#if value}<span class="value">{value}</span>{/if}
  {@render right?.()}
  {#if chevron}<span class="chev"><Glyph paths={icons.chevronRight} size={16} color="var(--label-3)" width={2.4} /></span>{/if}
{/snippet}

{#if onclick}
  <button class="cell tappable" class:disabled {onclick} {disabled}>{@render inner()}</button>
{:else}
  <div class="cell" class:disabled>{@render inner()}</div>
{/if}

<style>
  .cell { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 16px; text-align: left; color: var(--label); font-size: 17px; background: transparent; position: relative; }
  .cell + :global(.cell)::before { content: ''; position: absolute; top: 0; left: 16px; right: 0; border-top: 0.5px solid var(--separator); }
  .cell:has(:global(.icon)) + :global(.cell)::before { left: 58px; }
  .cell.tappable:active { background: var(--fill-2); }
  .cell.disabled { opacity: 0.45; }
  .text { flex: 1; min-width: 0; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .subtitle { font-size: 13px; color: var(--label-2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .value { color: var(--label-2); font-size: 17px; }
  .chev { display: inline-flex; margin-right: -4px; }
</style>

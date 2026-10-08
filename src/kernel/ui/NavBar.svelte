<script lang="ts">
  import type { Snippet } from 'svelte';
  import { nav } from '../nav/nav.svelte';
  import Glyph from './Glyph.svelte';
  import { icons } from './icons';
  let { title, back = '返回', large = false, right }: { title: string; back?: string | null; large?: boolean; right?: Snippet } = $props();
</script>

<header class="nav" class:large>
  <div class="row">
    <div class="side left">
      {#if back !== null}
        <button class="back" onclick={() => nav.pop()}>
          <Glyph paths={icons.chevronLeft} size={24} width={2.4} />
          <span>{back}</span>
        </button>
      {/if}
    </div>
    {#if !large}<h1 class="title">{title}</h1>{/if}
    <div class="side right">{@render right?.()}</div>
  </div>
  {#if large}<h1 class="title-large">{title}</h1>{/if}
</header>

<style>
  .nav { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg-grouped) 80%, transparent); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); padding-top: var(--safe-top); }
  .row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; height: 44px; padding: 0 8px; }
  .side { display: flex; align-items: center; min-width: 0; }
  .side.right { justify-content: flex-end; }
  .back { display: inline-flex; align-items: center; gap: 0; color: var(--tint); font-size: 17px; padding: 6px 4px 6px 0; }
  .back span { margin-left: -2px; }
  .title { font-size: 17px; font-weight: 600; margin: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title-large { font-size: 34px; font-weight: 700; letter-spacing: -0.4px; margin: 0; padding: 2px 16px 8px; }
  .nav:not(.large) { border-bottom: 0.5px solid var(--separator); }
  .nav.large { background: var(--bg-grouped); backdrop-filter: none; -webkit-backdrop-filter: none; }
</style>

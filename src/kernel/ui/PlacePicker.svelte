<script lang="ts">
  /**
   * 选一座城市：输入名字 → 候选列表（Open-Meteo 地理编码，自带时区）→ 点一个。
   * allowLocate 多一个「用当前位置」；allowClear 多一个「和你一样」（清掉）。选完 onpick，Sheet 自己关。
   */
  import Sheet from './Sheet.svelte';
  import List from './List.svelte';
  import Cell from './Cell.svelte';
  import Field from './Field.svelte';
  import Button from './Button.svelte';
  import { geocode, locate, type PlaceCandidate } from '../data/place';
  import type { Place } from '../api/types';

  let { open = $bindable(false), title = '在哪座城市', allowLocate = false, allowClear = false, onpick, onclose }: {
    open?: boolean; title?: string; allowLocate?: boolean; allowClear?: boolean; onpick: (p: Place | null) => void; onclose?: () => void;
  } = $props();
  let query = $state('');
  let results = $state<PlaceCandidate[]>([]);
  let searching = $state(false), locating = $state(false);
  let hint = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  function onInput(v: string) {
    query = v; hint = '';
    clearTimeout(timer);
    const q = v.trim();
    if (!q) { results = []; searching = false; return; }
    searching = true;
    timer = setTimeout(async () => {
      const my = ++seq;
      const r = await geocode(q);
      if (my !== seq) return;
      results = r; searching = false;
      if (!r.length) hint = '没找到这个地方，换个写法试试（中文或英文都行）';
    }, 350);
  }
  function pick(p: Place | null) {
    onpick(p);
    open = false;
    reset();
  }
  async function useLocation() {
    locating = true; hint = '';
    try { pick(await locate()); }
    catch (e) { hint = e instanceof Error ? e.message : String(e); }
    finally { locating = false; }
  }
  function reset() { query = ''; results = []; hint = ''; searching = false; }
  function close() { reset(); onclose?.(); }
</script>

<Sheet bind:open {title} onclose={close}>
  <List footer={hint || '只存在这台设备上，用来算那边几点、什么天气。'}>
    <Field label="城市" bind:value={query} placeholder="如 上海、Tokyo" oninput={onInput} />
  </List>
  {#if searching}
    <p class="note">查找中…</p>
  {:else if results.length}
    <List>
      {#each results as r (r.name + r.lat + r.lon)}
        <Cell title={r.name} subtitle={[r.detail, r.timeZone].filter(Boolean).join(' · ')} onclick={() => pick(r)} />
      {/each}
    </List>
  {/if}
  {#if allowLocate || allowClear}
    <div class="actions">
      {#if allowLocate}<Button kind="tinted" onclick={useLocation} disabled={locating}>{locating ? '定位中…' : '用当前位置'}</Button>{/if}
      {#if allowClear}<Button kind="plain" onclick={() => pick(null)}>和你一样</Button>{/if}
    </div>
  {/if}
  <div style="height:12px"></div>
</Sheet>

<style>
  .note { font-size: 14px; color: var(--label-2); margin: 4px 32px 8px; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 12px 16px 0; align-items: center; }
</style>

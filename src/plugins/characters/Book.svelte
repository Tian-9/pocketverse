<script lang="ts">
  /** 内嵌世界书总览：将导入 / 不导入 两栏，各条点进去编辑 */
  import { NavBar, List, Cell, SectionTitle, Placeholder, icons } from '$kernel/api';
  import { draft } from './draft.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  const sub = (e: (typeof draft.book)[number]) => e.constant ? '常驻' : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '无触发词';
  const inc = $derived(draft.book.map((e, i) => ({ e, i })).filter((x) => x.e.include));
  const exc = $derived(draft.book.map((e, i) => ({ e, i })).filter((x) => !x.e.include));
</script>

<NavBar title="卡里带的背景" back="检查" />
{#if draft.book.length === 0}
  <Placeholder title="没有条目" paths={icons.book} />
{/if}
<SectionTitle text={`将导入 · ${inc.length}`} />
{#if inc.length}
  <List footer="点进去可以改正文、触发词，或者取消导入。">
    {#each inc as { e, i } (i)}<Cell title={e.title} subtitle={sub(e)} chevron onclick={() => nav.push('characters', 'bookEntry', { index: i })} />{/each}
  </List>
{:else}
  <List><Cell title="没有" /></List>
{/if}
<SectionTitle text={`不导入 · ${exc.length}`} />
{#if exc.length}
  <List footer="点进去打开「导入这条」就会回到上面。">
    {#each exc as { e, i } (i)}<Cell title={e.title} subtitle={sub(e)} chevron onclick={() => nav.push('characters', 'bookEntry', { index: i })} />{/each}
  </List>
{:else}
  <List><Cell title="没有" /></List>
{/if}
<div style="height:40px"></div>

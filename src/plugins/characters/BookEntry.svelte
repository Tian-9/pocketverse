<script lang="ts">
  /** 内嵌世界书的单条：导入前查看、修改、决定是否导入 */
  import { NavBar, List, Field, Cell, Toggle, SectionTitle, Button } from '$kernel/api';
  import { draft } from './draft.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  let { index }: { index: number } = $props();
  const e = $derived(draft.book[index]);
  let keywords = $state('');
  // svelte-ignore state_referenced_locally
  if (e) keywords = e.triggers.keywords.join(', ');
  function syncKeywords() { if (e) e.triggers.keywords = keywords.split(/[,，、\n]/).map((k) => k.trim()).filter(Boolean); }
  function drop() { draft.book.splice(index, 1); nav.pop(); }
</script>

<NavBar title={e?.title || '条目'} back="世界书" />
{#if e}
  <List>
    <Field label="标题" bind:value={e.title} />
    <Cell title="导入这条">{#snippet right()}<Toggle bind:checked={e.include} label="导入" />{/snippet}</Cell>
  </List>
  <SectionTitle text="摘要（进目录）" />
  <List><Field multiline rows={2} bind:value={e.summary} placeholder="一句话" /></List>
  <SectionTitle text="正文" />
  <List><Field multiline rows={10} bind:value={e.content} /></List>
  <SectionTitle text="触发" />
  <List>
    <Field label="触发词" bind:value={keywords} placeholder="逗号分隔" oninput={syncKeywords} />
    <Cell title="常驻">{#snippet right()}<Toggle bind:checked={e.constant} label="常驻" />{/snippet}</Cell>
  </List>
  <div class="actions"><Button kind="plain" onclick={drop}><span style="color:var(--red)">从导入里移除</span></Button></div>
{/if}
<div style="height:40px"></div>

<style>.actions { display: flex; justify-content: center; margin: 20px 16px; }</style>

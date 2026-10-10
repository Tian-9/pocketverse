<script lang="ts">
  /** 预设里的一段：改标题正文、选位置、看可疑片段 */
  import { NavBar, List, Cell, Field, SectionTitle, Toggle } from '$kernel/api';
  import { presetDraft as d } from './preset.svelte';
  let { key }: { key: number } = $props();
  const e = $derived(d.entries.find((x) => x.key === key));
  const findings = $derived(d.findings.filter((f) => f.key === key));
</script>

<NavBar title={e?.title ?? '段落'} back="导入预设" />
{#if e}
  {#if findings.length}
    <SectionTitle text="可疑片段" />
    <List footer="删掉或改写正文里对应的话，这里会跟着消失。">
      {#each findings as f, i (i)}<Cell title={f.kind} subtitle={'…' + f.snippet + '…'} />{/each}
    </List>
  {/if}
  <List>
    <Field label="标题" bind:value={e.title} />
    <Cell title="导入这段">{#snippet right()}<Toggle bind:checked={e.include} label="导入" />{/snippet}</Cell>
    <Cell title="放在尾部" subtitle={e.position === 'tail' ? '对话历史之后、你这句之前。模型最听这里的' : '规则后面，和角色设定一起'}>{#snippet right()}<Toggle checked={e.position === 'tail'} label="尾部" onchange={(v) => (e.position = v ? 'tail' : 'system')} />{/snippet}</Cell>
  </List>
  <SectionTitle text="正文" />
  <List><Field multiline rows={12} bind:value={e.content} /></List>
{/if}
<div style="height:40px"></div>

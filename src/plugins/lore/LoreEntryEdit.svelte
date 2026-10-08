<script lang="ts">
  import { NavBar, List, Cell, Field, Toggle, SectionTitle, Button } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  let { id }: { id: string } = $props();
  const e = live(() => db().lore.get(id), undefined);
  let title = $state(''), summary = $state(''), content = $state(''), keywords = $state(''), regex = $state(''), order = $state('0');
  let constant = $state(false), recursive = $state(false);
  let loaded = $state(false);
  $effect(() => {
    const v = e.value;
    if (v && !loaded) { title = v.title; summary = v.summary; content = v.content; keywords = v.triggers.keywords.join(', '); regex = v.triggers.regex ?? ''; order = String(v.order); constant = v.constant; recursive = !!v.triggers.recursive; loaded = true; }
  });
  let t: ReturnType<typeof setTimeout> | undefined;
  function save() {
    clearTimeout(t);
    t = setTimeout(() => db().lore.update(id, {
      title: title.trim() || '未命名', summary: summary.trim(), content, order: Number(order) || 0, constant,
      triggers: { keywords: keywords.split(/[,，、\n]/).map((k) => k.trim()).filter(Boolean), regex: regex.trim() || undefined, recursive },
    }), 400);
  }
  async function remove() { await db().lore.delete(id); nav.pop(); }
</script>

<NavBar title={title || '条目'} back="世界书" />
{#if e.value}
  <List>
    <Field label="标题" bind:value={title} oninput={save} />
    <Field label="顺序" bind:value={order} type="number" oninput={save} />
  </List>
  <SectionTitle text="摘要（进目录，每轮都在）" />
  <List footer="一句话说清这条讲什么，模型靠它决定要不要读正文。">
    <Field multiline rows={2} bind:value={summary} placeholder="一句话" oninput={save} />
  </List>
  <SectionTitle text="正文" />
  <List><Field multiline rows={8} bind:value={content} placeholder="触发或被查询时才进上下文" oninput={save} /></List>
  <SectionTitle text="触发" />
  <List footer="最近几条消息里出现任一触发词就插入正文。常驻条目每轮都在，别多。">
    <Field label="触发词" bind:value={keywords} placeholder="逗号分隔" oninput={save} />
    <Field label="正则" bind:value={regex} placeholder="可选" oninput={save} />
    <Cell title="常驻">{#snippet right()}<Toggle bind:checked={constant} onchange={save} label="常驻" />{/snippet}</Cell>
    <Cell title="递归触发" subtitle="正文里的词也能触发别的条目">{#snippet right()}<Toggle bind:checked={recursive} onchange={save} label="递归" />{/snippet}</Cell>
  </List>
  <div class="actions"><Button kind="plain" onclick={remove}><span style="color:var(--red)">删除条目</span></Button></div>
{/if}
<div style="height:40px"></div>

<style>.actions { display: flex; justify-content: center; margin: 20px 16px; }</style>

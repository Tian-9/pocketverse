<script lang="ts">
  import { NavBar, List, Cell, Field, Toggle, SectionTitle, Button } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  let { id, back = '返回' }: { id: string; back?: string } = $props();
  const e = live(() => db().lore.get(id), undefined);
  let title = $state(''), summary = $state(''), content = $state(''), keywords = $state(''), regex = $state(''), order = $state('0');
  let constant = $state(false), recursive = $state(false), style = $state(false), tail = $state(false);
  let loaded = $state(false);
  $effect(() => {
    const v = e.value;
    if (v && !loaded) { title = v.title; summary = v.summary; content = v.content; keywords = v.triggers.keywords.join(', '); regex = v.triggers.regex ?? ''; order = String(v.order); constant = v.constant; recursive = !!v.triggers.recursive; style = v.kind === 'style'; tail = v.position === 'tail'; loaded = true; }
  });
  let t: ReturnType<typeof setTimeout> | undefined;
  function save() {
    clearTimeout(t);
    t = setTimeout(() => db().lore.update(id, {
      title: title.trim() || '未命名', summary: summary.trim(), content, order: Number(order) || 0, constant, kind: style ? 'style' : 'lore', position: style && tail ? 'tail' : 'system',
      triggers: { keywords: keywords.split(/[,，、\n]/).map((k) => k.trim()).filter(Boolean), regex: regex.trim() || undefined, recursive },
    }), 400);
  }
  async function remove() { await db().lore.delete(id); nav.pop(); }
</script>

<NavBar title={title || '条目'} {back} />
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
  {#if e.value.scope === 'world'}
    <SectionTitle text="类型" />
    <List footer="世界设定进目录、可检索、可被本局变化覆盖。风格指令像规则一样插入，不进目录。切换后条目会出现在另一个 App 里。">
      <Cell title="这是风格指令" subtitle={style ? '当前：风格指令' : '当前：世界设定'}>{#snippet right()}<Toggle bind:checked={style} onchange={save} label="风格指令" />{/snippet}</Cell>
      {#if style}
        <Cell title="放在尾部" subtitle={tail ? '对话历史之后、你这句之前。模型最听这里的，适合管输出格式和口吻' : '规则后面，和角色设定一起'}>{#snippet right()}<Toggle bind:checked={tail} onchange={save} label="尾部" />{/snippet}</Cell>
      {/if}
    </List>
  {:else if e.value.kind !== 'style'}
    <SectionTitle text="归属" />
    <List footer="这条只属于某个角色，和他聊时才生效。"><Cell title="角色专属设定" /></List>
  {/if}
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

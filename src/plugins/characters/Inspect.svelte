<script lang="ts">
  /** 导入前检查：字段可编辑，可疑项另开一页，内嵌世界书逐条可看可改，确认后才入库。 */
  import { NavBar, List, Field, SectionTitle, Button, Cell } from '$kernel/api';
  import type { ParsedCard } from '$kernel/importers/charaCard';
  import { cardToCharacterFields } from '$kernel/importers/charaCard';
  import { sanitize } from '$kernel/importers/scan';
  import { repo } from '$kernel/data/repo';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';
  import { draft } from './inspect.svelte';

  let { card, avatar, raw }: { card?: ParsedCard; avatar?: Blob; raw?: unknown } = $props();
  // 从角色列表进来时带 card；从子页面返回时草稿已经在
  // svelte-ignore state_referenced_locally
  if (card && !draft.active) draft.start(card, avatar, raw);
  const f = draft.fields;

  async function doImport() {
    const c0 = draft.card!;
    const fields = cardToCharacterFields({ ...c0, name: f.name, description: f.description, personality: f.personality, scenario: f.scenario, firstMessage: f.first_mes, exampleDialogue: f.mes_example, systemPrompt: f.system_prompt, creatorNotes: f.creator_notes });
    const c = await repo.createCharacter({ ...fields, avatar: draft.avatar });
    const book = $state.snapshot(draft.book).filter((e) => e.include);
    if (book.length) {
      await db().lore.bulkAdd(book.map(({ include: _i, ...e }) => ({ ...e, id: ulid(), worldId: c.worldId, scope: 'character' as const, characterIds: [c.id] })));
    }
    bus.emit('notify', { title: `已导入 ${c.name}`, body: book.length ? `带 ${book.length} 条角色世界书` : undefined, pluginId: 'characters' });
    draft.reset();
    nav.pop();
    nav.push('characters', 'detail', { id: c.id });
  }
  function exportSkeleton() {
    const skel = sanitize(draft.raw ?? { ...$state.snapshot(draft.fields), character_book: draft.card?.characterBook });
    const blob = new Blob([JSON.stringify(skel, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${f.name || 'card'}.skeleton.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function abandon() { draft.reset(); nav.pop(); }
  const n = $derived(draft.open.length);
  const ignoredN = $derived(draft.findings.length - draft.open.length);
</script>

<NavBar title="导入前检查" back="角色" />
<SectionTitle text="扫描" />
<List footer="扫描只在本机做，不调任何接口。它只是提醒，判断由你来做。">
  {#if draft.findings.length === 0}
    <Cell title="没有发现可疑内容" subtitle="破限、成人、未成年、非自愿、极端暴力都没匹配到" />
  {:else}
    <Cell title={n ? `${n} 处可疑内容待处理` : '可疑内容都处理完了'} subtitle={ignoredN ? `另有 ${ignoredN} 处已标记为没问题` : '点进去逐条编辑或标记'} chevron onclick={() => nav.push('characters', 'findings')} />
  {/if}
</List>

<SectionTitle text="字段" />
<List><Field label="名字" bind:value={f.name} /></List>
<SectionTitle text="描述" /><List><Field multiline rows={6} bind:value={f.description} /></List>
<SectionTitle text="性格" /><List><Field multiline rows={2} bind:value={f.personality} /></List>
<SectionTitle text="场景" /><List><Field multiline rows={2} bind:value={f.scenario} /></List>
<SectionTitle text="开场白" /><List><Field multiline rows={3} bind:value={f.first_mes} /></List>
<SectionTitle text="示例对话" /><List><Field multiline rows={4} bind:value={f.mes_example} /></List>
<SectionTitle text="作者系统提示" /><List footer="这一段会原样进常驻设定，破限常藏在这里。不认识的指令建议删掉。"><Field multiline rows={3} bind:value={f.system_prompt} /></List>
<SectionTitle text="作者备注（不进上下文）" /><List><Field multiline rows={2} bind:value={f.creator_notes} /></List>

{#if draft.book.length}
  <SectionTitle text={`内嵌世界书 · ${draft.book.filter((e) => e.include).length}/${draft.book.length} 条将导入`} />
  <List footer="作为这个角色专属的条目导入。点进去可以看正文、改触发词、决定要不要导。">
    {#each draft.book as e, i (i)}
      <Cell title={e.title} subtitle={(e.include ? '' : '不导入 · ') + (e.constant ? '常驻' : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '无触发词')} chevron onclick={() => nav.push('characters', 'bookEntry', { index: i })} />
    {/each}
  </List>
{/if}
<div class="actions">
  <Button onclick={doImport}>导入{n ? `（仍有 ${n} 处未处理）` : ''}</Button>
  <Button kind="tinted" onclick={exportSkeleton}>导出结构（脱敏，给开发者看格式）</Button>
  <Button kind="plain" onclick={abandon}><span style="color:var(--red)">放弃</span></Button>
</div>
<div style="height:40px"></div>

<style>.actions { display: flex; flex-direction: column; gap: 10px; margin: 20px 16px 0; align-items: center; }</style>

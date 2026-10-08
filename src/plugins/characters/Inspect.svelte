<script lang="ts">
  /** 导入前检查：每个字段可编辑，列出本机扫描到的可疑片段，确认后才入库。 */
  import { NavBar, List, Field, SectionTitle, Button, Cell } from '$kernel/api';
  import type { ParsedCard } from '$kernel/importers/charaCard';
  import { cardToCharacterFields } from '$kernel/importers/charaCard';
  import { parseLorebook } from '$kernel/importers/lorebook';
  import { scanFields, sanitize, type Finding } from '$kernel/importers/scan';
  import { repo } from '$kernel/data/repo';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  let { card, avatar, raw }: { card: ParsedCard; avatar?: Blob; raw?: unknown } = $props();
  // 这里就是要拿初始值：检查页是一次性的编辑副本
  // svelte-ignore state_referenced_locally
  let name = $state(card.name), description = $state(card.description), personality = $state(card.personality), scenario = $state(card.scenario);
  // svelte-ignore state_referenced_locally
  let firstMessage = $state(card.firstMessage), example = $state(card.exampleDialogue), systemPrompt = $state(card.systemPrompt), notes = $state(card.creatorNotes);
  let book = $state<ReturnType<typeof parseLorebook>>([]);
  // svelte-ignore state_referenced_locally
  try { if (card.characterBook) book = parseLorebook(card.characterBook); } catch { book = []; }
  let importBook = $state(true);

  const FIELD_LABEL: Record<string, string> = { name: '名字', description: '描述', personality: '性格', scenario: '场景', first_mes: '开场白', mes_example: '示例对话', system_prompt: '作者系统提示', creator_notes: '作者备注' };
  const findings = $derived<Finding[]>([
    ...scanFields({ name, description, personality, scenario, first_mes: firstMessage, mes_example: example, system_prompt: systemPrompt, creator_notes: notes }),
    ...(importBook ? book.flatMap((e, i) => scanFields({ [`世界书·${e.title || i + 1}`]: e.content })) : []),
  ]);
  const byKind = $derived(Object.entries(findings.reduce<Record<string, Finding[]>>((a, f) => ((a[f.kind] ??= []).push(f), a), {})));
  let dropped = $state(false);

  async function doImport() {
    const fields = cardToCharacterFields({ ...card, name, description, personality, scenario, firstMessage, exampleDialogue: example, systemPrompt, creatorNotes: notes });
    const c = await repo.createCharacter({ ...fields, avatar });
    if (importBook && book.length) {
      await db().lore.bulkAdd($state.snapshot(book).map((e) => ({ ...e, id: ulid(), worldId: c.worldId, scope: 'character' as const, characterIds: [c.id] })));
    }
    bus.emit('notify', { title: `已导入 ${c.name}`, body: book.length && importBook ? `带 ${book.length} 条角色世界书` : undefined, pluginId: 'characters' });
    nav.pop();
    nav.push('characters', 'detail', { id: c.id });
  }
  function exportSkeleton() {
    const skel = sanitize(raw ?? { name, description, personality, scenario, first_mes: firstMessage, mes_example: example, system_prompt: systemPrompt, character_book: card.characterBook });
    const blob = new Blob([JSON.stringify(skel, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name || 'card'}.skeleton.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function clearField(field: string) {
    if (field === 'system_prompt') systemPrompt = '';
    else if (field === 'creator_notes') notes = '';
    else if (field === 'mes_example') example = '';
    else if (field.startsWith('世界书·')) { const t = field.slice(4); book = book.filter((e, i) => (e.title || String(i + 1)) !== t); }
  }
</script>

<NavBar title="导入前检查" back="角色" />
<SectionTitle text={findings.length ? `扫描到 ${findings.length} 处可疑内容` : '扫描没有发现可疑内容'} />
<List footer={dropped ? '' : '扫描只在本机做，不调任何接口。它只是提醒，判断由你来做：擦边片段删掉再导入，账号最安全。'}>
  {#if findings.length === 0}
    <Cell title="干净" subtitle="没有匹配到破限、成人、未成年、非自愿、极端暴力的片段" />
  {/if}
  {#each byKind as [kind, list] (kind)}
    {#each list as f, i (kind + i)}
      <Cell title={`${kind} · ${FIELD_LABEL[f.field] ?? f.field}`} subtitle={`…${f.snippet}…`}
        onclick={['system_prompt', 'creator_notes', 'mes_example'].includes(f.field) || f.field.startsWith('世界书·') ? () => clearField(f.field) : undefined}
        value={['system_prompt', 'creator_notes', 'mes_example'].includes(f.field) || f.field.startsWith('世界书·') ? '清空该段' : undefined} />
    {/each}
  {/each}
</List>

<SectionTitle text="字段" />
<List><Field label="名字" bind:value={name} /></List>
<SectionTitle text="描述" /><List><Field multiline rows={6} bind:value={description} /></List>
<SectionTitle text="性格" /><List><Field multiline rows={2} bind:value={personality} /></List>
<SectionTitle text="场景" /><List><Field multiline rows={2} bind:value={scenario} /></List>
<SectionTitle text="开场白" /><List><Field multiline rows={3} bind:value={firstMessage} /></List>
<SectionTitle text="示例对话" /><List><Field multiline rows={4} bind:value={example} /></List>
<SectionTitle text="作者系统提示（破限常在这里）" /><List footer="这一段会原样进常驻设定。不认识的指令建议清空。"><Field multiline rows={3} bind:value={systemPrompt} /></List>
<SectionTitle text="作者备注（不会进上下文）" /><List><Field multiline rows={2} bind:value={notes} /></List>
{#if book.length}
  <SectionTitle text={`内嵌世界书 · ${book.length} 条`} />
  <List footer="作为这个角色专属的条目导入，导入后可以在世界书里逐条改。">
    <Cell title="一并导入" onclick={() => (importBook = !importBook)} value={importBook ? '是' : '否'} />
    {#each book as e, i (i)}<Cell title={e.title} subtitle={e.content.slice(0, 60)} />{/each}
  </List>
{/if}
<div class="actions">
  <Button onclick={doImport}>导入{findings.length ? `（仍有 ${findings.length} 处未处理）` : ''}</Button>
  <Button kind="tinted" onclick={exportSkeleton}>导出结构（脱敏，给开发者看格式）</Button>
  <Button kind="plain" onclick={() => { dropped = true; nav.pop(); }}><span style="color:var(--red)">放弃</span></Button>
</div>
<div style="height:40px"></div>

<style>.actions { display: flex; flex-direction: column; gap: 10px; margin: 20px 16px 0; align-items: center; }</style>

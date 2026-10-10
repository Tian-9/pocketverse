<script lang="ts">
  /** 预设导入前检查：段落逐条可开关可改，可疑的标出来，确认后才入库成一个风格包。 */
  import { NavBar, List, Cell, Field, SectionTitle, Button, Toggle } from '$kernel/api';
  import type { ParsedPreset } from '$kernel/importers/preset';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';
  import { presetDraft as d } from './preset.svelte';

  let { preset }: { preset?: ParsedPreset } = $props();
  // svelte-ignore state_referenced_locally
  if (preset) d.start(preset);
  $effect(() => () => d.reset());

  const included = $derived(d.entries.filter((e) => e.include));
  const flagged = $derived(new Set(d.findings.map((f) => f.key)));
  async function doImport() {
    const name = d.name.trim() || '风格包';
    const base = ((await db().lore.orderBy('order').last())?.order ?? 0) + 1;
    const rows = included.map((e, i) => ({
      id: ulid(), worldId: 'global', title: e.title.trim() || `段落 ${i + 1}`, summary: '', content: e.content, scope: 'world' as const, kind: 'style' as const,
      position: e.position, preset: name, triggers: { keywords: [] }, constant: true, order: base + i, enabled: true,
    }));
    if (rows.length) await db().lore.bulkAdd(rows);
    bus.emit('notify', { title: `已导入风格包「${name}」`, body: `${rows.length} 段，可在风格里整包开关`, pluginId: 'style' });
    await nav.pop();
  }
</script>

<NavBar title="导入预设" back="风格" />
<SectionTitle text="扫描" />
<List footer="只在本机做，不调任何接口。破限、擦边一类的段落默认建议不导入，判断由你来做。">
  {#if d.findings.length === 0}
    <Cell title="没有发现可疑内容" />
  {:else}
    <Cell title={`${d.findings.length} 处可疑内容`} subtitle={`涉及 ${flagged.size} 段，点进去看或者直接关掉`} />
  {/if}
</List>
<SectionTitle text="风格包" />
<List footer="整包一起开关、导出。段落都是常驻指令，位置决定放在规则后面还是对话之后。"><Field label="名字" bind:value={d.name} /></List>
<SectionTitle text={`段落 · ${included.length} / ${d.entries.length} 将导入`} />
<List>
  {#each d.entries as e (e.key)}
    <Cell title={(flagged.has(e.key) ? '⚠ ' : '') + e.title} subtitle={`${e.position === 'tail' ? '尾部' : '规则后'} · ${e.content.slice(0, 50).replace(/\n/g, ' ')}`} chevron onclick={() => nav.push('style', 'preset-entry', { key: e.key })}>
      {#snippet right()}<Toggle checked={e.include} label={e.title} onchange={(v) => (e.include = v)} />{/snippet}
    </Cell>
  {/each}
</List>
<div class="actions">
  <Button onclick={doImport} disabled={!included.length}>导入 {included.length} 段</Button>
  <Button kind="plain" onclick={() => nav.pop()}><span style="color:var(--red)">放弃</span></Button>
</div>
<div style="height:40px"></div>

<style>.actions { display: flex; flex-direction: column; gap: 10px; margin: 20px 16px 0; align-items: center; }</style>

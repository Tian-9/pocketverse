<script lang="ts">
  import { NavBar, List, Cell, Toggle, SectionTitle, Placeholder, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseLorebook } from '$kernel/importers/lorebook';
  import { parsePreset, exportPreset } from '$kernel/importers/preset';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';
  import type { LoreEntry } from '$kernel/storage/db';

  const entries = live(() => db().lore.orderBy('order').filter((e) => e.kind === 'style').toArray(), []);
  const loose = $derived(entries.value.filter((e) => !e.preset));
  const groups = $derived.by(() => {
    const m = new Map<string, LoreEntry[]>();
    for (const e of entries.value) if (e.preset) m.set(e.preset, [...(m.get(e.preset) ?? []), e]);
    return [...m.entries()].map(([name, list]) => ({ name, list, on: list.some((e) => e.enabled) }));
  });
  let fileInput: HTMLInputElement;

  /** 预设文件（酒馆聊天补全预设 / 本应用风格包）走检查页；世界书格式直接当零散指令导入 */
  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    try {
      let n = 0;
      for (const f of files) {
        const json = JSON.parse(await f.text());
        if ((json && typeof json === 'object' && Array.isArray(json.prompts)) || json?.pocketverse === 'preset') {
          nav.push('style', 'preset-inspect', { preset: parsePreset(json, f.name) });
          return;
        }
        const parsed = parseLorebook(json, 'style');
        await db().lore.bulkAdd(parsed.map((p) => ({ ...p, id: ulid(), worldId: 'global' })));
        n += parsed.length;
      }
      bus.emit('notify', { title: `已导入 ${n} 条风格指令`, pluginId: 'style' });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    }
  }
  async function toggleGroup(list: LoreEntry[], on: boolean) {
    await db().lore.bulkPut(list.map((e) => ({ ...e, enabled: on })));
  }
  function exportGroup(name: string, list: LoreEntry[]) {
    const blob = new Blob([exportPreset(name, list)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}.preset.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function removeGroup(name: string, list: LoreEntry[]) {
    if (!confirm(`删除风格包「${name}」的 ${list.length} 段？`)) return;
    await db().lore.bulkDelete(list.map((e) => e.id));
  }
  async function create() {
    const id = ulid();
    await db().lore.add({ id, worldId: 'global', title: '新指令', summary: '', content: '', scope: 'world', kind: 'style', triggers: { keywords: [] }, constant: true, order: (entries.value.at(-1)?.order ?? 0) + 1, enabled: true });
    nav.push('lore', 'entry', { id, back: '风格' });
  }
  const trig = (e: (typeof entries.value)[number]) => e.constant ? (e.position === 'tail' ? '常驻 · 尾部' : '常驻，每轮生效') : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '没有触发词也不常驻，不会生效';
</script>

<NavBar title="风格" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => fileInput.click()} aria-label="导入预设或风格指令"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>
<input type="file" accept=".json,application/json" multiple bind:this={fileInput} onchange={onFiles} hidden />

{#if entries.value.length === 0}
  <Placeholder title="还没有风格指令" body="右上角 + 导入酒馆的聊天补全预设，会变成一个可以整包开关的风格包；也能导入「教 AI 说粤语」这类世界书当零散指令。基础对话规则在设置里改。" paths={icons.sparkle} />
{/if}
{#each groups as g (g.name)}
  <SectionTitle text={`风格包 · ${g.name}`} />
  <List footer={g.on ? `${g.list.filter((e) => e.enabled).length} / ${g.list.length} 段生效` : '整包已关'}>
    <Cell title="整包开关" subtitle="关掉整包，单段的开关保留">{#snippet right()}<Toggle checked={g.on} label={g.name} onchange={(v) => toggleGroup(g.list, v)} />{/snippet}</Cell>
    {#each g.list as e (e.id)}
      <Cell title={e.title} subtitle={trig(e)} chevron onclick={() => nav.push('lore', 'entry', { id: e.id, back: '风格' })}>
        {#snippet right()}<Toggle checked={e.enabled} label={e.title} onchange={(v) => db().lore.update(e.id, { enabled: v })} />{/snippet}
      </Cell>
    {/each}
    <Cell title="导出这个包" onclick={() => exportGroup(g.name, g.list)} />
    <Cell title="删除这个包" onclick={() => removeGroup(g.name, g.list)} />
  </List>
{/each}
{#if loose.length}
  <SectionTitle text={`单条指令 · ${loose.length}`} />
  <List footer="常驻指令排在对话规则后面，标了尾部的放在对话之后。太多常驻指令会稀释角色设定。">
    {#each loose as e (e.id)}
      <Cell title={e.title} subtitle={trig(e)} chevron onclick={() => nav.push('lore', 'entry', { id: e.id, back: '风格' })}>
        {#snippet right()}<Toggle checked={e.enabled} label={e.title} onchange={(v) => db().lore.update(e.id, { enabled: v })} />{/snippet}
      </Cell>
    {/each}
  </List>
{/if}
<div class="actions"><button class="link" onclick={create}>新建指令</button></div>
<div style="height:40px"></div>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .actions { display: flex; justify-content: center; margin: 16px; }
  .link { color: var(--tint); font-size: 17px; }
</style>

<script lang="ts">
  import { NavBar, List, Cell, Toggle, SectionTitle, Placeholder, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseLorebook } from '$kernel/importers/lorebook';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  let worldId = $state<string | null>(null);
  $effect(() => { repo.ensureDefaultWorld().then((w) => (worldId = w.id)); });
  const world = live(() => (worldId ? db().worlds.get(worldId) : Promise.resolve(undefined)), undefined, () => [worldId]);
  const entries = live(() => db().lore.orderBy('order').toArray(), []);
  const pendingCount = live(() => db().overlays.filter((o) => o.pending === true).count(), 0);
  let fileInput: HTMLInputElement;

  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    const w = await repo.ensureDefaultWorld();
    try {
      let n = 0;
      for (const f of files) {
        const parsed = parseLorebook(JSON.parse(await f.text()));
        await db().lore.bulkAdd(parsed.map((p) => ({ ...p, id: ulid(), worldId: w.id })));
        n += parsed.length;
      }
      bus.emit('notify', { title: `已导入 ${n} 条世界书`, pluginId: 'lore' });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    }
  }
  async function create() {
    const w = await repo.ensureDefaultWorld();
    const id = ulid();
    await db().lore.add({ id, worldId: w.id, title: '新条目', summary: '', content: '', scope: 'world', triggers: { keywords: [] }, constant: false, order: (entries.value.at(-1)?.order ?? 0) + 1, enabled: true });
    nav.push('lore', 'entry', { id });
  }
  const trig = (e: (typeof entries.value)[number]) => e.constant ? '常驻' : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '没有触发词，只能被搜到';
</script>

<NavBar title="世界书" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => fileInput.click()} aria-label="导入世界书"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>
<input type="file" accept=".json,application/json" multiple bind:this={fileInput} onchange={onFiles} hidden />

{#if world.value}
  <SectionTitle text={world.value.name} />
  <List footer="模型每轮只看到目录（标题和摘要），正文在触发词命中或模型主动查询时才进上下文。">
    <Cell title="本局变化" subtitle="剧情改变世界书的地方，不动原文" value={pendingCount.value ? `${pendingCount.value} 条待确认` : undefined} chevron onclick={() => nav.push('lore', 'overlays')} />
  </List>
{/if}

<SectionTitle text={`条目 · ${entries.value.length}`} />
{#if entries.value.length === 0}
  <Placeholder title="还没有世界书" body="右上角 + 导入 SillyTavern 格式的世界书 JSON，或者新建条目。" paths={icons.book} />
{:else}
  <List>
    {#each entries.value as e (e.id)}
      <Cell title={e.title} subtitle={trig(e)} chevron onclick={() => nav.push('lore', 'entry', { id: e.id })}>
        {#snippet right()}<Toggle checked={e.enabled} label={e.title} onchange={(v) => db().lore.update(e.id, { enabled: v })} />{/snippet}
      </Cell>
    {/each}
  </List>
{/if}
<div class="actions"><button class="link" onclick={create}>新建条目</button></div>
<div style="height:40px"></div>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .actions { display: flex; justify-content: center; margin: 16px; }
  .link { color: var(--tint); font-size: 17px; }
</style>

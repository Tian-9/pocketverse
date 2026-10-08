<script lang="ts">
  /** 角色专属世界书：只在和这个角色聊时进上下文 */
  import { NavBar, List, Cell, Toggle, SectionTitle, Placeholder, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseLorebook } from '$kernel/importers/lorebook';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  let { id }: { id: string } = $props();
  const character = live(() => db().characters.get(id), undefined);
  const entries = live(() => db().lore.orderBy('order').filter((e) => e.kind !== 'style' && e.scope !== 'world' && !!e.characterIds?.includes(id)).toArray(), []);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    const ch = character.value; if (!ch) return;
    try {
      let n = 0;
      for (const f of files) {
        const parsed = parseLorebook(JSON.parse(await f.text()));
        await db().lore.bulkAdd(parsed.map((p) => ({ ...p, id: ulid(), worldId: ch.worldId, scope: 'character' as const, characterIds: [id] })));
        n += parsed.length;
      }
      bus.emit('notify', { title: `已给 ${ch.name} 导入 ${n} 条专属设定`, pluginId: 'characters' });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    }
  }
  async function create() {
    const ch = character.value; if (!ch) return;
    const eid = ulid();
    await db().lore.add({ id: eid, worldId: ch.worldId, title: '新条目', summary: '', content: '', scope: 'character', characterIds: [id], triggers: { keywords: [] }, constant: false, order: (entries.value.at(-1)?.order ?? 0) + 1, enabled: true });
    nav.push('lore', 'entry', { id: eid, back: ch.name });
  }
  const trig = (e: (typeof entries.value)[number]) => e.constant ? '常驻' : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '没有触发词，只能被搜到';
</script>

<NavBar title="他的世界书" back={character.value?.name ?? '角色'}>
  {#snippet right()}
    <button class="iconbtn" onclick={() => fileInput?.click()} aria-label="导入"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>
<input type="file" accept=".json,application/json" multiple bind:this={fileInput} onchange={onFiles} hidden />
<SectionTitle text={`专属设定 · ${entries.value.length}`} />
{#if entries.value.length === 0}
  <Placeholder title="还没有专属设定" body="角色卡内嵌的世界书导入后在这里。也可以右上角 + 导入一份只属于他的世界书，或者新建条目。只在和他聊时生效。" paths={icons.book} />
{:else}
  <List footer="只在和这个角色聊时进上下文。世界共享的设定放「世界书」App。">
    {#each entries.value as e (e.id)}
      <Cell title={e.title} subtitle={trig(e)} chevron onclick={() => nav.push('lore', 'entry', { id: e.id, back: character.value?.name ?? '角色' })}>
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

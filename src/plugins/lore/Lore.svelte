<script lang="ts">
  /** 某个世界的条目页：导入、新建、开关，改名字和摘要，删除世界。 */
  import { NavBar, List, Cell, Toggle, SectionTitle, Placeholder, Sheet, Field, Button, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseLorebook } from '$kernel/importers/lorebook';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  let { id }: { id: string } = $props();
  const world = live(() => db().worlds.get(id), undefined);
  const entries = live(() => db().lore.orderBy('order').filter((e) => e.worldId === id && e.kind !== 'style' && e.scope === 'world').toArray(), []);
  const inUse = live(() => db().campaigns.where('worldId').equals(id).count(), 0);
  let fileInput: HTMLInputElement;
  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    try {
      let n = 0;
      for (const f of files) {
        const parsed = parseLorebook(JSON.parse(await f.text()), 'lore');
        await db().lore.bulkAdd(parsed.map((p) => ({ ...p, id: ulid(), worldId: id })));
        n += parsed.length;
      }
      bus.emit('notify', { title: `已导入 ${n} 条`, pluginId: 'lore' });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    }
  }
  async function create() {
    const eid = ulid();
    await db().lore.add({ id: eid, worldId: id, title: '新条目', summary: '', content: '', scope: 'world', triggers: { keywords: [] }, constant: false, order: (entries.value.at(-1)?.order ?? 0) + 1, enabled: true });
    nav.push('lore', 'entry', { id: eid, back: world.value?.name ?? '世界' });
  }
  const trig = (e: (typeof entries.value)[number]) => e.constant ? '常驻' : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '没有触发词，只能被搜到';

  // ---- 改名、摘要、删除 ----
  let editing = $state(false);
  let name = $state('');
  let summary = $state('');
  function openEdit() { name = world.value?.name ?? ''; summary = world.value?.summary ?? ''; editing = true; }
  async function save() { await repo.updateWorld(id, { name: name.trim() || '未命名世界', summary }); editing = false; }
  async function remove() {
    if (!(await repo.deleteWorld(id))) { bus.emit('notify', { title: '删不掉', body: '有角色在这个世界里开着局，先去他的主页换个世界。' }); return; }
    editing = false;
    await nav.pop();
  }
</script>

<NavBar title={world.value?.name ?? '世界'} back="世界">
  {#snippet right()}
    <button class="iconbtn" onclick={() => fileInput.click()} aria-label="导入世界书"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>
<input type="file" accept=".json,application/json" multiple bind:this={fileInput} onchange={onFiles} hidden />

{#if world.value}
  <List footer={`${inUse.value ? `${inUse.value} 局在这个世界里。` : '还没有角色在这个世界里开局。'}这里只放世界级设定：地点、规则、历史，这个世界里所有角色共享。某个角色自己的背景在角色卡页的「人物背景」里。怎么说话、什么文风，放到「风格」里。`}>
    <Cell title={world.value.name} subtitle={world.value.summary || '没有摘要'} chevron onclick={openEdit} />
  </List>
{/if}

<SectionTitle text={`条目 · ${entries.value.length}`} />
{#if entries.value.length === 0}
  <Placeholder title="还没有条目" body="右上角 + 导入 SillyTavern 格式的世界书 JSON，或者新建条目。社区里教 AI 怎么说话的那种世界书，请导入到「风格」。" paths={icons.book} />
{:else}
  <List>
    {#each entries.value as e (e.id)}
      <Cell title={e.title} subtitle={trig(e)} chevron onclick={() => nav.push('lore', 'entry', { id: e.id, back: world.value?.name ?? '世界' })}>
        {#snippet right()}<Toggle checked={e.enabled} label={e.title} onchange={(v) => db().lore.update(e.id, { enabled: v })} />{/snippet}
      </Cell>
    {/each}
  </List>
{/if}
<div class="actions"><button class="link" onclick={create}>新建条目</button></div>
<div style="height:40px"></div>

<Sheet bind:open={editing} title="这个世界">
  <List footer="摘要会常驻在角色的上下文里。">
    <Field label="名字" bind:value={name} />
    <Field multiline rows={2} bind:value={summary} placeholder="摘要，可空" />
  </List>
  <div class="sheet-actions">
    <Button onclick={save}>保存</Button>
    <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除这个世界和它的条目</span></Button>
  </div>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .actions { display: flex; justify-content: center; margin: 16px; }
  .link { color: var(--tint); font-size: 17px; }
  .sheet-actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

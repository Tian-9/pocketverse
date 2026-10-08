<script lang="ts">
  import { NavBar, List, Cell, Toggle, SectionTitle, Placeholder, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseLorebook } from '$kernel/importers/lorebook';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  const entries = live(() => db().lore.orderBy('order').filter((e) => e.kind === 'style').toArray(), []);
  let fileInput: HTMLInputElement;

  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    try {
      let n = 0;
      for (const f of files) {
        const parsed = parseLorebook(JSON.parse(await f.text()), 'style');
        await db().lore.bulkAdd(parsed.map((p) => ({ ...p, id: ulid(), worldId: 'global' })));
        n += parsed.length;
      }
      bus.emit('notify', { title: `已导入 ${n} 条风格指令`, pluginId: 'style' });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    }
  }
  async function create() {
    const id = ulid();
    await db().lore.add({ id, worldId: 'global', title: '新指令', summary: '', content: '', scope: 'world', kind: 'style', triggers: { keywords: [] }, constant: true, order: (entries.value.at(-1)?.order ?? 0) + 1, enabled: true });
    nav.push('lore', 'entry', { id, back: '风格' });
  }
  const trig = (e: (typeof entries.value)[number]) => e.constant ? '常驻，每轮生效' : e.triggers.keywords.length ? '触发词：' + e.triggers.keywords.slice(0, 4).join('、') : '没有触发词也不常驻，不会生效';
</script>

<NavBar title="风格" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => fileInput.click()} aria-label="导入风格指令"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>
<input type="file" accept=".json,application/json" multiple bind:this={fileInput} onchange={onFiles} hidden />

<SectionTitle text={`指令 · ${entries.value.length}`} />
{#if entries.value.length === 0}
  <Placeholder title="还没有风格指令" body="社区里「教 AI 说粤语」「某种文风」这类世界书导入到这里。常驻的像规则一样每轮生效，带触发词的命中时插入。基础对话规则在设置里改。" paths={icons.sparkle} />
{:else}
  <List footer="常驻指令排在对话规则后面。太多常驻指令会稀释角色设定，建议不超过三条。">
    {#each entries.value as e (e.id)}
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

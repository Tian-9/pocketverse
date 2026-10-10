<script lang="ts">
  /** 「世界」App 首页：一个个世界（背景），点进去看条目。角色开一局时从这里选。 */
  import { NavBar, List, Cell, Sheet, Field, Button, SectionTitle, Placeholder, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';

  // 第一次打开保证有默认世界（写库不能放进 liveQuery，放 effect 里）
  $effect(() => { repo.ensureDefaultWorld(); });
  const worlds = live(() => db().worlds.orderBy('createdAt').toArray(), []);
  const counts = live(async () => {
    const es = await db().lore.filter((e) => e.kind !== 'style' && e.scope === 'world').toArray();
    const m: Record<string, number> = {};
    for (const e of es) m[e.worldId] = (m[e.worldId] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>);
  const pendingCount = live(() => db().overlays.filter((o) => o.pending === true).count(), 0);
  let creating = $state(false);
  let name = $state('');
  let summary = $state('');
  async function create() {
    if (!name.trim()) return;
    const w = await repo.createWorld(name, summary);
    creating = false; name = ''; summary = '';
    nav.push('lore', 'world', { id: w.id });
  }
</script>

<NavBar title="世界" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => (creating = true)} aria-label="新建世界"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

<List footer="一个世界就是一个背景：哈利·波特、修仙、你自己编的城市。角色开一局时选世界，同一张卡能在不同世界各玩一局。只属于某个角色的背景在角色卡页的「人物背景」里。">
  <Cell title="本局变化" subtitle="剧情改变世界的地方，不动原文" value={pendingCount.value ? `${pendingCount.value} 条待确认` : undefined} chevron onclick={() => nav.push('lore', 'overlays')} />
</List>

<SectionTitle text={`世界 · ${worlds.value.length}`} />
{#if worlds.value.length === 0}
  <Placeholder title="还没有世界" body="右上角 + 新建一个。" paths={icons.book} />
{:else}
  <List>
    {#each worlds.value as w (w.id)}
      <Cell title={w.name} subtitle={w.summary || undefined} value={`${counts.value[w.id] ?? 0} 条`} chevron onclick={() => nav.push('lore', 'world', { id: w.id })} />
    {/each}
  </List>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={creating} title="新建世界">
  <div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) { e.preventDefault(); create(); } }} role="presentation">
    <List footer="摘要一两句话，会常驻在角色的上下文里，告诉他这是个什么样的世界。">
      <Field label="名字" bind:value={name} placeholder="霍格沃茨" />
      <Field multiline rows={2} bind:value={summary} placeholder="摘要，可空" />
    </List>
  </div>
  <div class="actions"><Button onclick={create} disabled={!name.trim()}>创建</Button></div>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .actions { display: flex; flex-direction: column; margin: 12px 16px 0; align-items: center; }
</style>

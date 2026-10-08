<script lang="ts">
  import { NavBar, List, Cell, SectionTitle, Placeholder, Button, Sheet, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import type { LoreOverlay } from '$kernel/storage/db';

  interface Row extends LoreOverlay { who: string; original?: string }
  const rows = live(async (): Promise<Row[]> => {
    const all = await db().overlays.reverse().sortBy('createdAt');
    const out: Row[] = [];
    for (const o of all) {
      const c = await db().campaigns.get(o.campaignId);
      const e = o.loreEntryId ? await db().lore.get(o.loreEntryId) : undefined;
      out.push({ ...o, who: c?.name ?? '?', original: e?.title });
    }
    return out;
  }, []);
  const pending = $derived(rows.value.filter((r) => r.pending));
  const active = $derived(rows.value.filter((r) => !r.pending));
  let open = $state<Row | null>(null);
  async function accept(o: Row) { await db().overlays.update(o.id, { pending: false }); open = null; }
  async function remove(o: Row) { await db().overlays.delete(o.id); open = null; }
</script>

<NavBar title="本局变化" back="世界书" />
{#if rows.value.length === 0}
  <Placeholder title="还没有变化" body="剧情改变世界时，角色或记忆整理会把变化记在这里。原始世界书永远不会被改。" paths={icons.book} />
{/if}
{#if pending.length}
  <SectionTitle text="待确认" />
  <List footer="记忆整理提出的变化，采纳后才会影响对话。">
    {#each pending as o (o.id)}<Cell title={o.title} subtitle={`${o.who} · ${o.summary}`} chevron onclick={() => (open = o)} />{/each}
  </List>
{/if}
{#if active.length}
  <SectionTitle text="已生效" />
  <List>
    {#each active as o (o.id)}<Cell title={o.title} subtitle={`${o.who} · ${o.original ? '改变了「' + o.original + '」' : '新增'}`} chevron onclick={() => (open = o)} />{/each}
  </List>
{/if}
<div style="height:40px"></div>

<Sheet open={!!open} title={open?.title}>
  {#if open}
    <div class="body">
      <p class="meta">{open.who}{open.original ? ` · 改变了「${open.original}」` : ' · 新增事实'}{open.reason ? ` · 起因：${open.reason}` : ''}</p>
      <p class="sum">{open.summary}</p>
      <p class="content">{open.content}</p>
    </div>
    <div class="actions">
      {#if open.pending}<Button onclick={() => accept(open!)}>采纳</Button>{/if}
      <Button kind="tinted" onclick={() => remove(open!)}><span style="color:var(--red)">删除</span></Button>
      <Button kind="plain" onclick={() => (open = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<style>
  .body { padding: 0 20px; }
  .meta { font-size: 13px; color: var(--label-2); margin: 0 0 8px; }
  .sum { font-weight: 600; margin: 0 0 8px; }
  .content { white-space: pre-wrap; line-height: 1.5; margin: 0; max-height: 40vh; overflow-y: auto; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 16px 16px 0; align-items: center; }
</style>

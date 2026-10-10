<script lang="ts">
  import { NavBar, Placeholder, Avatar, Glyph, Sheet, List, Cell, Button, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { registry } from '$kernel/registry/registry.svelte';
  import { bus } from '$kernel/bus/bus';
  import { diaryApi, today, type DiaryEntry } from './index';

  interface Row extends DiaryEntry { name: string; avatar?: Blob }
  const rows = live(async (): Promise<Row[]> => {
    if (!registry.isEnabled('diary')) return [];
    const { repo } = await import('$kernel/data/repo');
    const current = await repo.currentCampaignIds();
    const es = (await diaryApi.entries().reverse().sortBy('date')).filter((e) => current.has(e.campaignId));
    const out: Row[] = [];
    for (const e of es) { const ch = await db().characters.get(e.characterId); if (ch) out.push({ ...e, name: ch.name, avatar: ch.avatar }); }
    return out;
  }, []);
  const chars = live(() => db().characters.toArray(), []);
  let picking = $state(false);
  let busy = $state(false);
  let reading = $state<Row | null>(null);

  async function writeFor(characterId: string) {
    picking = false; busy = true;
    try {
      const ch = await db().characters.get(characterId); if (!ch) return;
      const { repo } = await import('$kernel/data/repo');
      const cp = await repo.campaignFor(ch);
      const date = today();
      if (await diaryApi.forDate(cp.id, date)) { bus.emit('notify', { title: '今天已经写过了', body: '删掉再写可以重写' }); return; }
      const e = await diaryApi.write(cp.id, ch.id, date, 'manual');
      if (!e) bus.emit('notify', { title: '没写出来', body: '先在设置里配置 API Key' });
    } catch (e) { bus.emit('notify', { title: '生成失败', body: e instanceof Error ? e.message : String(e) }); }
    finally { busy = false; }
  }
  async function remove() { if (reading) await diaryApi.entries().delete(reading.id); reading = null; }
  const weekday = (d: string) => ['日', '一', '二', '三', '四', '五', '六'][new Date(d + 'T00:00').getDay()];
</script>

<NavBar title="日记" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => (picking = true)} aria-label="让角色写今天的日记" disabled={busy}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if rows.value.length === 0}
  <Placeholder title="还没有日记" body="你离开 6 小时以上再回来，角色会补写前一天的日记（那天得聊过）。右上角 + 可以让他现在写今天的。" paths={icons.diary} />
{:else}
  <div class="feed">
    {#each rows.value as e (e.id)}
      <button class="entry" onclick={() => (reading = e)}>
        <div class="date"><span class="d">{e.date.slice(5).replace('-', '/')}</span><span class="w">周{weekday(e.date)}</span></div>
        <div class="body">
          <div class="who"><Avatar blob={e.avatar} name={e.name} size={22} /> {e.name}{e.source === 'auto' ? '' : ' · 手动'}</div>
          <p class="text">{e.text}</p>
        </div>
      </button>
    {/each}
  </div>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={picking} title="让谁写今天的日记">
  <List>
    {#each chars.value as c (c.id)}<Cell title={c.name} onclick={() => writeFor(c.id)} />{/each}
    {#if !chars.value.length}<Cell title="还没有角色" />{/if}
  </List>
</Sheet>
<Sheet open={!!reading} onclose={() => (reading = null)} title={reading ? `${reading.name} · ${reading.date}` : ''}>
  {#if reading}
    <p class="full">{reading.text}</p>
    <div class="actions">
      <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除这篇</span></Button>
      <Button kind="plain" onclick={() => (reading = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .feed { background: var(--bg-surface); margin-top: 8px; }
  .entry { display: flex; gap: 14px; width: 100%; padding: 14px 16px; border-bottom: 0.5px solid var(--separator); text-align: left; }
  .entry:active { background: var(--fill-2); }
  .date { display: flex; flex-direction: column; align-items: center; flex: 0 0 48px; padding-top: 2px; }
  .d { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .w { font-size: 11px; color: var(--label-2); }
  .body { flex: 1; min-width: 0; }
  .who { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--label-2); margin-bottom: 4px; }
  .text { margin: 0; font-size: 15px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
  .full { margin: 0 24px; font-size: 16px; line-height: 1.7; white-space: pre-wrap; max-height: 55vh; overflow-y: auto; }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 12px 16px 0; align-items: center; }
</style>

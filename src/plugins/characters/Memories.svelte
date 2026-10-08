<script lang="ts">
  import { NavBar, List, Cell, SectionTitle, Placeholder, Button, Sheet, icons } from '$kernel/api';
  import type { EpisodicMemory, MemFile } from '$kernel/storage/db';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { chat } from '$kernel/chat/engine.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';

  let { id }: { id: string } = $props();
  // 存档可能需要创建（写操作），不能放在 liveQuery 里，先解析出 id
  let campaignId = $state<string | null>(null);
  $effect(() => { db().characters.get(id).then((c) => c && repo.campaignFor(c)).then((cp) => (campaignId = cp?.id ?? null)); });
  const character = live(() => db().characters.get(id), undefined);
  const deps = () => [campaignId];
  const campaign = live(() => (campaignId ? db().campaigns.get(campaignId) : Promise.resolve(undefined)), undefined, deps);
  const memories = live(() => (campaignId ? db().memories.where('campaignId').equals(campaignId).reverse().sortBy('createdAt') : Promise.resolve([])), [], deps);
  const files = live(() => (campaignId ? db().memfs.where('campaignId').equals(campaignId).toArray() : Promise.resolve([])), [], deps);
  let busy = $state(false);
  let pickedMem = $state<EpisodicMemory | null>(null);
  let pickedFile = $state<MemFile | null>(null);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

  async function consolidateNow() {
    const c = character.value; if (!c) return;
    const conv = await repo.directConversation(c);
    busy = true;
    try {
      const ok = await chat.consolidateNow(conv.id);
      bus.emit('notify', { title: ok ? '整理完成' : '没有新内容需要整理' });
    } catch (e) { bus.emit('notify', { title: '整理失败', body: e instanceof Error ? e.message : String(e) }); }
    finally { busy = false; }
  }
  async function resetState() {
    const cp = campaign.value; if (!cp) return;
    await db().campaigns.update(cp.id, { state: { relations: {}, mood: {}, facts: [] } });
  }
</script>

<NavBar title="记忆" back={character.value?.name ?? '角色'} />
{#if campaign.value}
  {@const s = campaign.value.state}
  <SectionTitle text="当前状态" />
  <List footer="角色在对话中用 state.update 更新，记忆整理也会更新。">
    <Cell title="剧情时间" value={s.inWorldTime || '—'} />
    <Cell title="地点" value={s.location || '—'} />
    <Cell title="关系" subtitle={s.relations[id] || '—'} />
    <Cell title="情绪" subtitle={s.mood[id] || '—'} />
    {#each s.facts as f, i (i)}<Cell title={f} />{/each}
  </List>
  <SectionTitle text={`情节记忆 · ${memories.value.length}`} />
  {#if memories.value.length === 0}
    <Placeholder title="还没有记忆" body="每聊 12 轮会自动整理一次，也可以现在手动整理。" paths={icons.sparkle} />
  {:else}
    <List footer="三星的会作为近期要事常驻上下文，其余靠模型主动搜索。点一条可以删除。">
      {#each memories.value as m (m.id)}
        <Cell title={m.text} subtitle={`${stars(m.importance)}${m.when ? ' · ' + m.when : ''}`} onclick={() => (pickedMem = m)} />
      {/each}
    </List>
  {/if}
  {#if files.value.length}
    <SectionTitle text="角色自己的笔记 /memories" />
    <List footer="模型通过 memory 工具自己维护的文件。">
      {#each files.value as f (f.path)}<Cell title={f.path.replace('/memories/', '')} subtitle={f.content.split('\n')[0]} chevron onclick={() => (pickedFile = f)} />{/each}
    </List>
  {/if}
  <div class="actions">
    <Button kind="tinted" onclick={consolidateNow} disabled={busy}>{busy ? '整理中…' : '现在整理记忆'}</Button>
    <Button kind="plain" onclick={() => nav.push('lore', 'overlays')}>查看本局世界变化</Button>
    <Button kind="plain" onclick={resetState}><span style="color:var(--red)">重置状态</span></Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet open={!!pickedMem} onclose={() => (pickedMem = null)} title="这条记忆">
  {#if pickedMem}
    <p class="body">{pickedMem.text}</p>
    <div class="actions">
      <Button kind="tinted" onclick={async () => { await db().memories.delete(pickedMem!.id); pickedMem = null; }}><span style="color:var(--red)">删除</span></Button>
      <Button kind="plain" onclick={() => (pickedMem = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>
<Sheet open={!!pickedFile} onclose={() => (pickedFile = null)} title={pickedFile?.path.replace('/memories/', '')}>
  {#if pickedFile}
    <pre class="file">{pickedFile.content}</pre>
    <div class="actions">
      <Button kind="tinted" onclick={async () => { await db().memfs.delete([pickedFile!.campaignId, pickedFile!.path]); pickedFile = null; }}><span style="color:var(--red)">删除文件</span></Button>
      <Button kind="plain" onclick={() => (pickedFile = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<style>
  .body { margin: 0 24px 8px; line-height: 1.5; }
  .file { margin: 0 20px; padding: 12px; background: var(--bg-surface); border-radius: 10px; font-size: 13px; white-space: pre-wrap; max-height: 40vh; overflow-y: auto; }.actions { display: flex; flex-direction: column; gap: 10px; margin: 20px 16px 0; align-items: center; }</style>

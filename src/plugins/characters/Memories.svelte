<script lang="ts">
  import { NavBar, List, Cell, Field, SectionTitle, Placeholder, Button, Sheet, icons } from '$kernel/api';
  import type { EpisodicMemory, MemFile, CampaignState } from '$kernel/storage/db';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { chat } from '$kernel/chat/engine.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  let { id }: { id: string } = $props();
  let campaignId = $state<string | null>(null);
  $effect(() => { db().characters.get(id).then((c) => c && repo.campaignFor(c)).then((cp) => (campaignId = cp?.id ?? null)); });
  const deps = () => [campaignId];
  const character = live(() => db().characters.get(id), undefined);
  const campaign = live(() => (campaignId ? db().campaigns.get(campaignId) : Promise.resolve(undefined)), undefined, deps);
  const memories = live(() => (campaignId ? db().memories.where('campaignId').equals(campaignId).reverse().sortBy('createdAt') : Promise.resolve([])), [], deps);
  const files = live(() => (campaignId ? db().memfs.where('campaignId').equals(campaignId).toArray() : Promise.resolve([])), [], deps);
  let busy = $state(false);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

  // ---- 编辑：记忆 ----
  let mem = $state<EpisodicMemory | null>(null);
  let memText = $state(''), memWhen = $state(''), memImp = $state<1 | 2 | 3>(2);
  function openMem(m: EpisodicMemory | null) {
    mem = m ?? { id: '', campaignId: campaignId!, characterId: id, when: '', text: '', importance: 2, sourceMessageIds: [], createdAt: Date.now() };
    memText = mem.text; memWhen = mem.when; memImp = mem.importance;
  }
  async function saveMem() {
    if (!mem || !memText.trim()) { mem = null; return; }
    const row: EpisodicMemory = { ...$state.snapshot(mem), id: mem.id || ulid(), text: memText.trim(), when: memWhen.trim(), importance: memImp };
    await db().memories.put(row); mem = null;
  }
  async function deleteMem() { if (mem?.id) await db().memories.delete(mem.id); mem = null; }

  // ---- 编辑：状态 ----
  let editingState = $state(false);
  let st = $state({ inWorldTime: '', location: '', relation: '', mood: '', facts: '' });
  function openState() {
    const s = campaign.value?.state; if (!s) return;
    st = { inWorldTime: s.inWorldTime ?? '', location: s.location ?? '', relation: s.relations[id] ?? '', mood: s.mood[id] ?? '', facts: s.facts.join('\n') };
    editingState = true;
  }
  async function saveState() {
    const cp = campaign.value; if (!cp) return;
    const base = $state.snapshot(cp.state);
    const s: CampaignState = { ...base, relations: { ...base.relations }, mood: { ...base.mood } };
    s.inWorldTime = st.inWorldTime.trim() || undefined; s.location = st.location.trim() || undefined;
    if (st.relation.trim()) s.relations[id] = st.relation.trim(); else delete s.relations[id];
    if (st.mood.trim()) s.mood[id] = st.mood.trim(); else delete s.mood[id];
    s.facts = st.facts.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 20);
    await db().campaigns.update(cp.id, { state: s }); editingState = false;
  }

  // ---- 编辑：笔记文件 ----
  let file = $state<MemFile | null>(null);
  let fileText = $state('');
  function openFile(f: MemFile) { file = f; fileText = f.content; }
  async function saveFile() { if (file) await db().memfs.put({ ...$state.snapshot(file), content: fileText, updatedAt: Date.now() }); file = null; }
  async function deleteFile() { if (file) await db().memfs.delete([file.campaignId, file.path]); file = null; }

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
</script>

<NavBar title="记忆" back={character.value?.name ?? '角色'} />
{#if campaign.value}
  {@const s = campaign.value.state}
  <SectionTitle text="当前状态" />
  <List footer="角色在对话中用 state_update 更新，记忆整理也会更新。点任意一行手改。">
    <Cell title="剧情时间" value={s.inWorldTime || '—'} onclick={openState} />
    <Cell title="地点" value={s.location || '—'} onclick={openState} />
    <Cell title="关系" subtitle={s.relations[id] || '—'} onclick={openState} />
    <Cell title="情绪" subtitle={s.mood[id] || '—'} onclick={openState} />
    {#each s.facts as f, i (i)}<Cell title={f} onclick={openState} />{/each}
  </List>
  <SectionTitle text={`情节记忆 · ${memories.value.length}`} />
  {#if memories.value.length === 0}
    <Placeholder title="还没有记忆" body="每聊 12 轮会自动整理一次，也可以现在手动整理，或者自己写一条。" paths={icons.sparkle} />
  {:else}
    <List footer="三星的会作为近期要事常驻上下文，其余靠模型主动搜索。点一条可以改或删。">
      {#each memories.value as m (m.id)}
        <Cell title={m.text} subtitle={`${stars(m.importance)}${m.when ? ' · ' + m.when : ''}`} chevron onclick={() => openMem(m)} />
      {/each}
    </List>
  {/if}
  {#if files.value.length}
    <SectionTitle text="角色自己的笔记 /memories" />
    <List footer="模型通过 memory 工具自己维护的文件，可以手改。">
      {#each files.value as f (f.path)}<Cell title={f.path.replace('/memories/', '')} subtitle={f.content.split('\n')[0]} chevron onclick={() => openFile(f)} />{/each}
    </List>
  {/if}
  <div class="actions">
    <Button kind="tinted" onclick={consolidateNow} disabled={busy}>{busy ? '整理中…' : '现在整理记忆'}</Button>
    <Button kind="plain" onclick={() => openMem(null)}>手写一条记忆</Button>
    <Button kind="plain" onclick={() => nav.push('lore', 'overlays')}>查看本局世界变化</Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet open={!!mem} onclose={() => (mem = null)} title={mem?.id ? '编辑记忆' : '新记忆'}>
  {#if mem}
    <List>
      <Field multiline rows={3} bind:value={memText} placeholder="发生了什么，一两句话" />
      <Field label="时间" bind:value={memWhen} placeholder="剧情时间，可空" />
    </List>
    <div class="seg">
      {#each [1, 2, 3] as n (n)}<button class:on={memImp === n} onclick={() => (memImp = n as 1 | 2 | 3)}>{stars(n)}</button>{/each}
    </div>
    <p class="hint">三星：改变关系或剧情走向的大事，会常驻上下文。二星：值得记住。一星：日常。</p>
    <div class="actions">
      <Button onclick={saveMem}>保存</Button>
      {#if mem.id}<Button kind="plain" onclick={deleteMem}><span style="color:var(--red)">删除</span></Button>{/if}
    </div>
  {/if}
</Sheet>
<Sheet bind:open={editingState} title="当前状态">
  <List footer="事实一行一条，最多 20 条。">
    <Field label="剧情时间" bind:value={st.inWorldTime} placeholder="可空" />
    <Field label="地点" bind:value={st.location} placeholder="可空" />
    <Field multiline rows={2} bind:value={st.relation} placeholder="关系：角色与你现在的关系，一句话" />
    <Field multiline rows={2} bind:value={st.mood} placeholder="情绪：角色现在的情绪，一句话" />
    <Field multiline rows={5} bind:value={st.facts} placeholder="当前事实，一行一条" />
  </List>
  <div class="actions"><Button onclick={saveState}>保存</Button></div>
</Sheet>
<Sheet open={!!file} onclose={() => (file = null)} title={file?.path.replace('/memories/', '')}>
  {#if file}
    <div class="box"><textarea bind:value={fileText} rows="10" spellcheck="false"></textarea></div>
    <div class="actions">
      <Button onclick={saveFile}>保存</Button>
      <Button kind="plain" onclick={deleteFile}><span style="color:var(--red)">删除文件</span></Button>
    </div>
  {/if}
</Sheet>

<style>
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 16px 16px 0; align-items: center; }
  .seg { display: flex; gap: 6px; margin: 12px 16px 0; }
  .seg button { flex: 1; padding: 8px; border-radius: 8px; background: var(--fill-2); color: var(--label-2); letter-spacing: 2px; }
  .seg button.on { background: var(--tint); color: var(--tint-fg); }
  .hint { margin: 8px 24px 0; font-size: 12px; color: var(--label-2); }
  .box { margin: 0 16px; background: var(--bg-surface); border-radius: 12px; padding: 8px 12px; }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 14px; line-height: 1.5; resize: vertical; font-family: ui-monospace, Menlo, monospace; }
</style>

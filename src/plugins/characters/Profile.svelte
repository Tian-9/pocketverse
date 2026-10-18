<script lang="ts">
  /**
   * 角色主页：这一局里的他。身份（名字、头像）只读角色卡；状态、钱包、朋友圈、记忆都按存档。
   * 插件通过 profileSections 往这里挂段，主页本身不认识段的内容。
   */
  import { NavBar, List, Cell, Field, SectionTitle, Placeholder, Button, Sheet, Avatar, Toggle, icons } from '$kernel/api';
  import type { ProfileSection } from '$kernel/api';
  import type { EpisodicMemory, MemFile, CampaignState, Campaign, World } from '$kernel/storage/db';
  import { registry } from '$kernel/registry/registry.svelte';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { chat } from '$kernel/chat/engine.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { clock } from '$kernel/context/clock';
  import { applyPatches, loadState } from '$kernel/memory/state';
  import { liveEntries, stateView, type StateSetEvent } from 'annals/state';
  import { parseBag, type Bag } from 'annals';
  import { fromUserMacro, toUserMacro } from '$kernel/context/userref';
  import { dayOf, memoryWhen, storyStartOf } from '$kernel/context/days';
  import { explainRecall, RECALL_K, RECALL_MIN_SCORE, type RecallExplain } from '$kernel/memory/recall';
  import { ulid } from 'ulid';

  let { id }: { id: string } = $props();
  let campaignId = $state<string | null>(null);
  $effect(() => { db().characters.get(id).then((c) => c && repo.campaignFor(c)).then((cp) => (campaignId = cp?.id ?? null)); });
  const deps = () => [campaignId];
  const character = live(() => db().characters.get(id), undefined);
  const world = live(() => (campaignId ? db().campaigns.get(campaignId).then((c) => (c ? db().worlds.get(c.worldId) : undefined)) : Promise.resolve(undefined)), undefined, deps);
  // 这张卡的所有局：同一张卡可以在不同世界各开一局，这里切换或新开
  const saves = live(() => repo.campaignsOf(id), [] as Campaign[]);
  const worlds = live(() => db().worlds.orderBy('createdAt').toArray(), [] as World[]);
  let savesOpen = $state(false);
  let pickWorld = $state(false);
  // 新开一局从哪天开始：默认今天；选了别的日子就从那天的这个钟点开始（走表）
  let startDate = $state('');
  async function switchTo(cpId: string) { await repo.setCurrentCampaign(id, cpId); campaignId = cpId; savesOpen = false; }
  async function startIn(worldId: string) {
    const ch = character.value; if (!ch) return;
    const c = await repo.newCampaign(ch, worldId, startTsOf(startDate));
    campaignId = c.id; pickWorld = false; savesOpen = false; startDate = '';
  }
  function startTsOf(date: string): number | undefined {
    const day = clock.fromInput(date);
    if (day === null) return undefined;
    const d = new Date(day), n = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), n.getHours(), n.getMinutes()).getTime();
  }

  // ---- 编辑：这一局的时钟 ----
  let editingClock = $state(false);
  let clockAt = $state(''), clockPaused = $state(false);
  function openClock() {
    const cp = campaign.value; if (!cp) return;
    clockAt = clock.toInput(clock.now(cp.clock)); clockPaused = cp.clock?.running === false; editingClock = true;
  }
  async function saveClock() {
    const cp = campaign.value; if (!cp) return;
    const ts = clock.fromInput(clockAt);
    if (ts === null) return;
    await repo.setClock(cp.id, clock.setRunning(clock.skipTo(cp.clock, ts), !clockPaused));
    editingClock = false;
  }
  const clockText = (cp: Campaign) => `Day ${dayOf(clock.now(cp.clock), storyStartOf(cp), character.value?.timeZone)} · ${clock.format(clock.now(cp.clock), character.value?.timeZone)}${cp.clock?.running === false ? ' · 停表' : ''}`;
  // 记忆的时间：「Day 36（11/14 周五 晚上，4 天前）」，和给模型看的同一个格式
  const memWhen = (m: EpisodicMemory) => (campaign.value ? memoryWhen(m, storyStartOf(campaign.value), clock.now(campaign.value.clock), character.value?.timeZone) : m.when);
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  type Section = ProfileSection & { pluginId: string };
  const sections = $derived<Section[]>(registry.plugins.filter((p) => registry.isEnabled(p.id)).flatMap((p) => (p.profileSections ?? []).map((s) => ({ ...s, pluginId: p.id }))));
  async function startChat(offline = false) {
    const ch = character.value; if (!ch) return;
    const conv = offline ? await repo.sceneConversation(ch) : await repo.directConversation(ch);
    await nav.home();
    nav.push('chat', 'app');
    nav.push('chat', 'conversation', { id: conv.id });
  }
  const campaign = live(() => (campaignId ? db().campaigns.get(campaignId) : Promise.resolve(undefined)), undefined, deps);
  const memories = live(() => (campaignId ? db().memories.where('campaignId').equals(campaignId).reverse().sortBy('createdAt') : Promise.resolve([])), [], deps);
  // 硬事实：annals 状态事件折叠出来的，最近变化的在最后
  const stateRows = live(() => (campaignId ? loadState(campaignId) : Promise.resolve([])), [], deps);
  const factEntries = $derived(liveEntries(stateView(stateRows.value)).slice(-20));
  const files = live(() => (campaignId ? db().memfs.where('campaignId').equals(campaignId).toArray() : Promise.resolve([])), [], deps);
  // 你在这一局叫什么：存档上填了就用它，没填用设置里的名字。库里存 {{user}}，显示时换成名字，手改保存时换回去
  const myName = $derived(campaign.value?.userName?.trim() || chat.userName);
  const show = (t: string | undefined) => fromUserMacro(t ?? '', myName, character.value?.name ?? '');
  const keep = (t: string) => toUserMacro(t, myName);
  let busy = $state(false);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

  // ---- 编辑：记忆 ----
  let mem = $state<EpisodicMemory | null>(null);
  let memText = $state(''), memWhenText = $state(''), memImp = $state<1 | 2 | 3>(2);
  // 检索词袋（annals 三档）：整理时模型写的，回忆和自动召回靠它；这里能看能改，用顿号或空格隔开
  let bagCore = $state(''), bagRelated = $state(''), bagHint = $state('');
  const joinTerms = (l?: readonly string[]) => (l ?? []).map(show).join('、');
  const splitTerms = (t: string) => t.split(/[、，,\s]+/).map((x) => keep(x.trim())).filter(Boolean);
  function openMem(m: EpisodicMemory | null) {
    // 手写的记忆记成现在的剧情时刻
    mem = m ?? { id: '', campaignId: campaignId!, characterId: id, when: '', text: '', importance: 2, sourceMessageIds: [], createdAt: Date.now(), storyTs: clock.now(campaign.value?.clock) };
    memText = show(mem.text); memWhenText = show(mem.when); memImp = mem.importance;
    bagCore = joinTerms(mem.bag?.core); bagRelated = joinTerms(mem.bag?.related); bagHint = joinTerms(mem.bag?.hint);
  }
  async function saveMem() {
    if (!mem || !memText.trim()) { mem = null; return; }
    const bag: Bag = parseBag({ core: splitTerms(bagCore), related: splitTerms(bagRelated), hint: splitTerms(bagHint) }, { core: 3, total: 30 });
    const { bag: _old, ...base } = $state.snapshot(mem);
    const row: EpisodicMemory = { ...base, id: mem.id || ulid(), text: keep(memText.trim()), when: keep(memWhenText.trim()), importance: memImp, ...(Object.keys(bag).length ? { bag } : {}) };
    await db().memories.put(row); mem = null;
  }
  async function deleteMem() { if (mem?.id) await db().memories.delete(mem.id); mem = null; }

  // ---- 检索试验台：输入一句话，看每轮自动召回会翻出哪几条（和聊天时同一套索引和打分，不调模型） ----
  let probe = $state('');
  // 近期要事：最近 10 条三星，本来就常驻，召回时跳过
  const pinnedIds = $derived(new Set(memories.value.filter((m) => m.importance === 3).slice(0, 10).map((m) => m.id)));
  const probeHits = $derived(explainRecall(memories.value, probe, pinnedIds));
  const verdict: Record<RecallExplain['status'], string> = { recalled: '会召回', pinned: '三星常驻，不重复召回', weak: '分数不够', overflow: `够分，但排在前 ${RECALL_K} 条之后` };

  // ---- 编辑：硬事实（状态事件）：手改和清除都是新事件，来源 manual，历史不丢 ----
  let fact = $state<{ entity: string; attr: string; value: string; isNew: boolean } | null>(null);
  function openFact(e: StateSetEvent | null) {
    fact = e ? { entity: show(e.payload.entity), attr: e.payload.attr, value: show(e.payload.value), isNew: false } : { entity: '', attr: '', value: '', isNew: true };
  }
  async function writeFact(value: string) {
    const cp = campaign.value; const f = fact; fact = null;
    if (!cp || !f || !f.entity.trim() || !f.attr.trim()) return;
    await applyPatches(cp.id, [{ entity: keep(f.entity.trim().slice(0, 40)), attr: f.attr.trim().slice(0, 24), value: keep(value.trim().slice(0, 160)) }], { source: 'manual', at: clock.now(cp.clock) });
  }

  // ---- 编辑：状态 ----
  let editingState = $state(false);
  let st = $state({ location: '', relation: '', mood: '', facts: '', nudge: '' });
  function openState() {
    const cp = campaign.value; const s = cp?.state; if (!cp || !s) return;
    st = { location: show(s.location), relation: show(s.relations[id]), mood: show(s.mood[id]), facts: s.facts.map(show).join('\n'), nudge: s.nudge?.[id] ?? '' };
    editingState = true;
  }
  async function saveState() {
    const cp = campaign.value; if (!cp) return;
    const base = $state.snapshot(cp.state);
    const s: CampaignState = { ...base, relations: { ...base.relations }, mood: { ...base.mood } };
    s.location = keep(st.location.trim()) || undefined;
    if (st.relation.trim()) s.relations[id] = keep(st.relation.trim()); else delete s.relations[id];
    if (st.mood.trim()) s.mood[id] = keep(st.mood.trim()); else delete s.mood[id];
    s.nudge = { ...(base.nudge ?? {}) };
    if (st.nudge.trim()) s.nudge[id] = st.nudge.trim().slice(0, 20); else delete s.nudge[id];
    s.facts = st.facts.split('\n').map((f) => keep(f.trim())).filter(Boolean).slice(0, 20);
    await db().campaigns.update(cp.id, { state: s }); editingState = false;
  }

  // ---- 编辑：你在这一局（名字、人设）：按存档存，修仙世界里是师弟，校园里是同桌 ----
  let editingMe = $state(false);
  let meName = $state(''), mePersona = $state('');
  function openMe() {
    const cp = campaign.value; if (!cp) return;
    meName = cp.userName ?? ''; mePersona = cp.userPersona ?? ''; editingMe = true;
  }
  async function saveMe() {
    const cp = campaign.value; if (!cp) return;
    await db().campaigns.update(cp.id, { userName: meName.trim().slice(0, 20) || undefined, userPersona: mePersona.trim().slice(0, 300) || undefined });
    editingMe = false;
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

<NavBar title={character.value?.name ?? '主页'} back="返回" />
{#if campaign.value && character.value}
  {@const s = campaign.value.state}
  {@const cp = campaign.value}
  <div class="hero">
    <Avatar blob={character.value.avatar} name={character.value.name} size={88} />
    <div class="name">{character.value.name}</div>
    <button class="save" onclick={() => (savesOpen = true)}>{world.value?.name ?? '…'}{saves.value.length > 1 ? ` · 共 ${saves.value.length} 局` : ''} ›</button>
  </div>
  <List footer={s.facts.length ? '状态、地点、和你：他在对话中用 state_update 更新，记忆整理也会更新。下面几行是旧格式的事实，现在不会再自动更新，只能手改；新的事实记在下一栏「硬事实」。点任意一行手改。' : '他在对话中用 state_update 更新，记忆整理也会更新。点任意一行手改。'}>
    <Cell title="状态" subtitle={show(s.mood[id]) || '—'} onclick={openState} />
    <Cell title="地点" value={show(s.location) || '—'} onclick={openState} />
    <Cell title="和你" subtitle={show(s.relations[id]) || '—'} onclick={openState} />
    <Cell title="拍一拍" value={s.nudge?.[id] ? '拍了拍他' + s.nudge[id] : '—'} onclick={openState} />
    {#each s.facts as f, i (i)}<Cell title={show(f)} onclick={openState} />{/each}
  </List>
  <List footer="只在这一局生效：他在这一局怎么叫你、你在这个世界里是谁。名字留空就用设置里的名字。记忆和状态里存的是「你」这个位置，改了名字旧记忆也跟着变。">
    <Cell title="你在这局叫" value={cp.userName?.trim() ? cp.userName : `${chat.userName}（跟设置）`} onclick={openMe} />
    <Cell title="你在这局是" subtitle={cp.userPersona || '—'} onclick={openMe} />
  </List>
  <List footer="硬事实：东西在哪、归谁、谁欠谁多少、谁答应了什么。他在对话里和整理时记，删那条消息会一起撤回。点一条可以改或清除。">
    {#each factEntries as e (e.id)}<Cell title={`${show(e.payload.entity)} · ${e.payload.attr}`} subtitle={show(e.payload.value)} onclick={() => openFact(e)} />{/each}
    <Cell title="添加一条" onclick={() => openFact(null)} />
  </List>
  <List footer={cp.clock?.running === false ? '停表：你不来他就定在这一刻，只有推进才动。' : cp.clock ? '这局的时间和真实时间一起走，只是不在同一天。' : '和真实时间一样。在聊天里「推进时间」可以往前跳，这里能改成任何时候或停表。'}>
    <Cell title="这局的时间" value={clockText(cp)} onclick={openClock} />
  </List>
  {#each sections as sec (sec.pluginId + '/' + sec.id)}
    {@const Comp = sec.component}
    {#if sec.label}<SectionTitle text={sec.label} />{/if}
    <Comp campaignId={cp.id} characterId={id} />
  {/each}
  <SectionTitle text={`他记得什么 · ${memories.value.length}`} />
  {#if memories.value.length === 0}
    <Placeholder title="还没有记忆" body="每聊 12 轮会自动整理一次，也可以现在手动整理，或者自己写一条。" paths={icons.sparkle} />
  {:else}
    <List footer="三星的会作为近期要事常驻上下文；其余每轮按你说的话自动翻出相关的几条，模型也能自己搜。点一条可以改词袋、改内容或删除。">
      {#each memories.value as m (m.id)}
        <Cell title={show(m.text)} subtitle={`${stars(m.importance)}${memWhen(m) ? ' · ' + show(memWhen(m)) : ''}`} chevron onclick={() => openMem(m)} />
      {/each}
    </List>
  {/if}
  {#if memories.value.length}
    <SectionTitle text="检索试验台" />
    <List footer={`输入一句你可能会说的话，看每轮自动召回会翻出哪几条。不发消息、不花钱。分数到 ${RECALL_MIN_SCORE} 才召回，最多 ${RECALL_K} 条。点一条可以直接改词袋再试。`}>
      <Field bind:value={probe} placeholder="比如：小姨子最近胖了没" />
      {#each probeHits as h (h.memory.id)}
        <Cell title={show(h.memory.text)} subtitle={`${h.score.toFixed(2)} 分 · ${verdict[h.status]} · 命中：${h.terms.map(show).join('、')}`} chevron onclick={() => openMem(h.memory)} />
      {/each}
      {#if probe.trim() && !probeHits.length}<Cell title="一条都没命中" />{/if}
    </List>
  {/if}
  {#if files.value.length}
    <SectionTitle text="角色自己的笔记 /memories" />
    <List footer="模型通过 memory 工具自己维护的文件，可以手改。">
      {#each files.value as f (f.path)}<Cell title={f.path.replace('/memories/', '')} subtitle={f.content.split('\n')[0]} chevron onclick={() => openFile(f)} />{/each}
    </List>
  {/if}
  <div class="actions">
    <Button onclick={() => startChat()}>发消息</Button>
    <Button kind="tinted" onclick={() => startChat(true)}>线下见面</Button>
    <Button kind="tinted" onclick={consolidateNow} disabled={busy}>{busy ? '整理中…' : '现在整理记忆'}</Button>
    <Button kind="plain" onclick={() => openMem(null)}>手写一条记忆</Button>
    <Button kind="plain" onclick={() => nav.push('lore', 'overlays')}>查看本局世界变化</Button>
    <Button kind="plain" onclick={() => nav.push('characters', 'detail', { id })}>编辑角色卡</Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet open={!!mem} onclose={() => (mem = null)} title={mem?.id ? '编辑记忆' : '新记忆'}>
  {#if mem}
    <List>
      <Field multiline rows={3} bind:value={memText} placeholder="发生了什么，一两句话" />
      <Field label="时段" bind:value={memWhenText} placeholder="早上、放学后、半夜，可空（哪天由 Day 记）" />
    </List>
    <List footer="检索词：你聊到这些词时，这条会被自动翻出来。核心词最多 3 个，放主体和外号；相关词放动作、地点、时间；联想词放别人可能用来问起这件事的说法。用顿号或空格隔开。">
      <Field label="核心词" bind:value={bagCore} placeholder="小姨子、小猫" />
      <Field label="相关词" bind:value={bagRelated} placeholder="周末、猫粮" />
      <Field label="联想词" bind:value={bagHint} placeholder="可空" />
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
<Sheet bind:open={savesOpen} title="他在哪个世界">
  <List footer="同一张卡可以在不同世界各开一局，记忆、状态、钱包各算各的。聊天、朋友圈、补发只看当前这一局。">
    {#each saves.value as cp (cp.id)}
      {@const w = worlds.value.find((x) => x.id === cp.worldId)}
      <Cell title={w?.name ?? cp.name} subtitle={`${cp.id === campaignId ? '当前这一局 · ' : ''}上次 ${fmtDate(cp.lastPlayedAt)}`} onclick={() => switchTo(cp.id)} />
    {/each}
  </List>
  <div class="actions"><Button kind="tinted" onclick={() => (pickWorld = true)}>换个世界新开一局</Button></div>
</Sheet>
<Sheet bind:open={pickWorld} title="选一个世界">
  <List footer="不改就从今天开始。他的故事发生在别的年代就改这里，之后时间照样一天一天过。">
    <Field label="从哪天开始" type="date" bind:value={startDate} />
  </List>
  <List footer="没有想要的世界，去「世界」App 建一个。">
    {#each worlds.value as w (w.id)}<Cell title={w.name} subtitle={w.summary || undefined} onclick={() => startIn(w.id)} />{/each}
  </List>
</Sheet>
<Sheet bind:open={editingClock} title="这局的时间">
  <List footer="停表：他定在这一刻，离开多久都不会有变化，只有你推进才动。走表：和真实时间一起过。">
    <Field label="现在是" type="datetime-local" bind:value={clockAt} />
    <Cell title="停表" subtitle={clockPaused ? '现在：定住，只有推进才动' : '现在：和真实时间一起走'}>{#snippet right()}<Toggle bind:checked={clockPaused} label="停表" />{/snippet}</Cell>
  </List>
  <div class="actions"><Button onclick={saveClock}>保存</Button></div>
</Sheet>
<Sheet open={!!fact} onclose={() => (fact = null)} title={fact?.isNew ? '新事实' : '改这条事实'}>
  {#if fact}
    <List footer="value 写成主宾分明的一句话，比如「他 欠 用户 49.5 元」；没定的写「未明确（原因）」。">
      {#if fact.isNew}
        <Field label="谁 / 什么" bind:value={fact.entity} placeholder="猫、债务#红包、用户" />
        <Field label="哪方面" bind:value={fact.attr} placeholder="位置、归属、欠款、承诺" />
      {:else}
        <Cell title={`${fact.entity} · ${fact.attr}`} />
      {/if}
      <Field multiline rows={2} bind:value={fact.value} placeholder="现在的值" />
    </List>
    <div class="actions">
      <Button onclick={() => writeFact(fact!.value)}>保存</Button>
      {#if !fact.isNew}<Button kind="plain" onclick={() => writeFact('')}><span style="color:var(--red)">清除</span></Button>{/if}
    </div>
  {/if}
</Sheet>
<Sheet bind:open={editingMe} title="你在这一局">
  <List footer="只在这一局生效。名字留空就用设置里的名字。">
    <Field label="名字" bind:value={meName} placeholder={chat.userName} />
    <Field multiline rows={3} bind:value={mePersona} placeholder="你在这个世界里是谁：一两句话，如「刚入门的师弟」。空着就只用设置里的用户画像" />
  </List>
  <div class="actions"><Button onclick={saveMe}>保存</Button></div>
</Sheet>
<Sheet bind:open={editingState} title="当前状态">
  <List footer="事实一行一条，最多 20 条。">
    <Field label="地点" bind:value={st.location} placeholder="可空" />
    <Field multiline rows={2} bind:value={st.mood} placeholder="状态：他现在的情绪，一句话" />
    <Field multiline rows={2} bind:value={st.relation} placeholder="和你：他和你现在的关系，一句话" />
    <Field label="拍一拍" bind:value={st.nudge} placeholder="后缀，如「的小脑袋」；他自己也会定" />
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
  .hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 18px; }
  .name { font-size: 20px; font-weight: 600; }
  .save { font-size: 13px; color: var(--tint); }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 16px 16px 0; align-items: center; }
  .seg { display: flex; gap: 6px; margin: 12px 16px 0; }
  .seg button { flex: 1; padding: 8px; border-radius: 8px; background: var(--fill-2); color: var(--label-2); letter-spacing: 2px; }
  .seg button.on { background: var(--tint); color: var(--tint-fg); }
  .hint { margin: 8px 24px 0; font-size: 12px; color: var(--label-2); }
  .box { margin: 0 16px; background: var(--bg-surface); border-radius: 12px; padding: 8px 12px; }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 14px; line-height: 1.5; resize: vertical; font-family: ui-monospace, Menlo, monospace; }
</style>

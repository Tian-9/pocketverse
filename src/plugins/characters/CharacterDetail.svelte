<script lang="ts">
  import { NavBar, List, Cell, Field, SectionTitle, Button, Avatar, Sheet, Toggle } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseStChat } from '$kernel/importers/stChat';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';
  import { isValidTimeZone } from '$kernel/context/time';
  import { backup, deleteVersionsOf, versionsTable, snapshotOf, sameData, type VersionData } from './versions';
  import type { Character } from '$kernel/storage/db';

  let { id }: { id: string } = $props();
  const c = live(() => db().characters.get(id), undefined);
  const loreCount = live(() => db().lore.filter((e) => e.kind !== 'style' && e.scope !== 'world' && !!e.characterIds?.includes(id)).count(), 0);
  let name = $state(''), core = $state(''), full = $state(''), firstMessage = $state('');
  let useFirst = $state(false);
  let timeZone = $state('');
  let loaded = $state(false);
  let confirmDelete = $state(false);
  const versionCount = live(() => versionsTable().where('characterId').equals(id).count(), 0);
  // 进页面时的样子：第一次改动前留一份历史版本
  let original: Character | null = null;
  // 最后一次是我们自己写进库的内容；库里的值和它不一样，就是别处改了（如恢复了历史版本），把字段重新读进来
  let written: VersionData | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const v = c.value;
    if (!v) return;
    if (loaded && (saveTimer !== undefined || (written && sameData(written, snapshotOf(v))))) return;
    name = v.name; core = v.core; full = v.full; firstMessage = v.firstMessage ?? ''; useFirst = !!v.useFirstMessage; timeZone = v.timeZone ?? '';
    loaded = true; original = $state.snapshot(v) as Character; written = snapshotOf(v);
  });
  // 时区：留空＝和你同一个时区；写了但不认识就当没写
  const tzOk = $derived(!timeZone.trim() || isValidTimeZone(timeZone.trim()));
  function save() {
    clearTimeout(saveTimer);
    if (original) { backup(original, '编辑前').catch(() => {}); original = null; }
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const patch = { name: name.trim() || '未命名', core, full, firstMessage: firstMessage || undefined, useFirstMessage: useFirst, timeZone: tzOk && timeZone.trim() ? timeZone.trim() : undefined };
      written = snapshotOf({ id, ...patch });
      repo.updateCharacter(id, patch);
    }, 400);
  }
  async function startChat() {
    const ch = await db().characters.get(id);
    if (!ch) return;
    const conv = await repo.directConversation(ch);
    await nav.home();
    nav.push('chat', 'app');
    nav.push('chat', 'conversation', { id: conv.id });
  }
  let chatInput = $state<HTMLInputElement | null>(null);
  async function importChat(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      const parsed = parseStChat(await f.text());
      const ch = await db().characters.get(id); if (!ch) return;
      const conv = await repo.directConversation(ch);
      await db().messages.bulkAdd(parsed.messages.map((m) => ({ id: ulid(), conversationId: conv.id, role: m.role, content: [{ type: 'text', text: m.text }], ts: m.ts, meta: { imported: 'sillytavern' } })));
      if (parsed.summary) {
        const cp = await repo.campaignFor(ch);
        await db().memories.add({ id: ulid(), campaignId: cp.id, characterId: ch.id, when: '导入前', text: `酒馆里的摘要：${parsed.summary}`, importance: 3, sourceMessageIds: [], createdAt: Date.now() });
      }
      bus.emit('notify', { title: `导入了 ${parsed.messages.length} 条聊天记录`, body: '去他的主页点一次整理，记忆就会从旧对话里长出来', pluginId: 'characters' });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    }
  }
  async function remove() {
    await deleteVersionsOf(id);
    await repo.deleteCharacter(id);
    nav.pop();
  }
</script>

<NavBar title={name || '角色'} back="角色" />
{#if c.value}
  <div class="hero"><Avatar blob={c.value.avatar} name={name || '?'} size={88} /></div>
  <List>
    <Field label="名字" bind:value={name} placeholder="角色名" oninput={save} />
  </List>
  <SectionTitle text="核心设定（常驻上下文）" />
  <List footer="每轮对话都会带上这一段，尽量精炼。更长的背景放到下面的完整设定里，模型需要时才会去读。">
    <Field multiline rows={8} bind:value={core} placeholder="他是谁、什么性格、现在的处境" oninput={save} />
  </List>
  <SectionTitle text="完整设定与示例对话" />
  <List>
    <Field multiline rows={6} bind:value={full} placeholder="示例对话、细节背景" oninput={save} />
  </List>
  <SectionTitle text="时间" />
  <List footer={tzOk ? '默认他和你用同一个时间（你设备的时间）。他出远门、在另一个时区生活时才填，写法如 Asia/Tokyo、Europe/London，他会知道自己那边几点。这一局的剧情时间从哪天开始、要不要停表，在他的主页上改。' : '不认识这个时区，先按和你同一个时间算。写法如 Asia/Tokyo、America/New_York。'}>
    <Field label="他所在的时区" bind:value={timeZone} placeholder="留空＝和你一样" oninput={save} />
  </List>
  <SectionTitle text="人物背景" />
  <List footer="跟卡走的设定，和他聊时才进上下文，换世界也带着。">
    <Cell title="人物背景" value={`${loreCount.value} 条`} chevron onclick={() => nav.push('characters', 'lore', { id })} />
  </List>
  <SectionTitle text="历史版本" />
  <List footer="改卡之前自动留一份，最多 30 份，随时能恢复。">
    <Cell title="历史版本" value={versionCount.value ? `${versionCount.value} 份` : '还没有'} chevron onclick={() => nav.push('characters', 'versions', { id })} />
  </List>
  <SectionTitle text="开场白" />
  <List footer="酒馆卡的开场白多半是为酒馆场景写的，默认不自动发。写了适合手机聊天的再打开。">
    <Field multiline rows={3} bind:value={firstMessage} placeholder="新对话的第一句话" oninput={save} />
    <Cell title="新对话自动发送">{#snippet right()}<Toggle bind:checked={useFirst} onchange={save} label="自动发送开场白" />{/snippet}</Cell>
  </List>
  <div class="actions">
    <Button onclick={startChat}>开始聊天</Button>
    <Button kind="tinted" onclick={() => nav.push('characters', 'profile', { id })}>他的主页</Button>
    <Button kind="plain" onclick={() => chatInput?.click()}>导入酒馆聊天记录（.jsonl）</Button>
    <input type="file" accept=".jsonl,.json,text/plain" bind:this={chatInput} onchange={importChat} hidden />
    <Button kind="plain" onclick={() => (confirmDelete = true)}><span style="color:var(--red)">删除角色</span></Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={confirmDelete} title="删除角色？">
  <p class="warn">会一起删掉和这个角色的全部对话和记忆，不能恢复。</p>
  <div class="actions">
    <Button onclick={remove}><span>删除</span></Button>
    <Button kind="tinted" onclick={() => (confirmDelete = false)}>取消</Button>
  </div>
</Sheet>

<style>
  .hero { display: flex; justify-content: center; padding: 8px 0 18px; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 24px 16px 0; align-items: center; }
  .warn { font-size: 15px; color: var(--label-2); margin: 0 24px 8px; text-align: center; }
</style>

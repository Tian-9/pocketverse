<script lang="ts">
  import { NavBar, List, Placeholder, Avatar, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo, previewOf } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { chat } from '$kernel/chat/engine.svelte';

  interface Row { id: string; name: string; avatar?: Blob; last: string; ts: number; offline: boolean }
  const rows = live(async (): Promise<Row[]> => {
    // 一个角色一行：只列他当前这一局的会话，别的世界的局不出现
    const current = await repo.currentCampaignIds();
    // 线下会话在「线下」App 里列
    const convs = await db().conversations.filter((c) => c.pluginId === 'chat' && c.kind === 'direct' && current.has(c.campaignId)).toArray();
    const out: Row[] = [];
    for (const cv of convs) {
      const ch = cv.participantIds[0] ? await db().characters.get(cv.participantIds[0]) : undefined;
      if (!ch) continue;
      // 追加段（给模型看的隐藏快照）不当最后一条
      const last = await db().messages.where('conversationId').equals(cv.id).reverse().filter((m) => !m.meta?.context).first();
      // 线下会话（面对面推剧情）单独一行，标出来；空的线下会话也列着，不然建了找不到
      out.push({ id: cv.id, name: ch.name, avatar: ch.avatar, last: last ? previewOf(last) : '', ts: last?.ts ?? 0, offline: cv.kind === 'scene' });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }, []);

  function when(ts: number) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
</script>

<NavBar title="信息" large back="桌面" />
{#if rows.value.length === 0}
  <Placeholder title="还没有对话" body="去「角色」里导入一张角色卡，点「开始聊天」。" paths={icons.chat} />
{:else}
  <List>
    {#each rows.value as r (r.id)}
      <button class="row" onclick={() => nav.push('chat', 'conversation', { id: r.id })}>
        <Avatar blob={r.avatar} name={r.name} size={52} />
        <span class="text">
          <span class="line1"><span class="name">{r.name}{#if r.offline}<span class="tag">线下</span>{/if}</span><span class="time">{when(r.ts)}</span></span>
          <span class="last">{chat.statusOf(r.id) !== 'idle' ? (r.offline ? '…' : '正在输入…') : r.last || (r.offline ? '写一句开场，在哪、什么情况' : '开始对话')}</span>
        </span>
      </button>
    {/each}
  </List>
{/if}
<div style="height:40px"></div>

<style>
  .row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; position: relative; }
  .row + .row::before { content: ''; position: absolute; top: 0; left: 80px; right: 0; border-top: 0.5px solid var(--separator); }
  .row:active { background: var(--fill-2); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .line1 { display: flex; justify-content: space-between; align-items: baseline; }
  .name { font-size: 17px; font-weight: 600; }
  .tag { margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--tint); border: 1px solid var(--tint); border-radius: 4px; padding: 0 4px; vertical-align: 2px; }
  .time { font-size: 14px; color: var(--label-2); font-variant-numeric: tabular-nums; }
  .last { font-size: 15px; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>

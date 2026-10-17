<script lang="ts">
  /** 「线下」App：一个角色一行，点进去是和他面对面的那条会话（没有就建）。见 ARCHITECTURE 6.1 */
  import { NavBar, List, Placeholder, Avatar, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import type { Character } from '$kernel/storage/db';
  import { repo, previewOf } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { chat } from '$kernel/chat/engine.svelte';

  interface Row { character: Character; convId?: string; last: string; ts: number }
  const rows = live(async (): Promise<Row[]> => {
    const current = await repo.currentCampaignIds();
    const out: Row[] = [];
    for (const ch of await db().characters.toArray()) {
      const cp = (await repo.campaignsOf(ch.id)).find((c) => current.has(c.id));
      if (!cp) continue;
      const cv = await db().conversations.where('campaignId').equals(cp.id).filter((c) => c.kind === 'scene' && c.pluginId === 'chat').first();
      const last = cv ? await db().messages.where('conversationId').equals(cv.id).reverse().filter((m) => !m.meta?.context).first() : undefined;
      out.push({ character: ch, convId: cv?.id, last: last ? previewOf(last) : '', ts: last?.ts ?? 0 });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }, []);
  async function open(r: Row) {
    const conv = r.convId ? await db().conversations.get(r.convId) : await repo.sceneConversation(r.character);
    if (conv) nav.push('chat', 'conversation', { id: conv.id });
  }
  function when(ts: number) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
</script>

<NavBar title="线下" large back="桌面" />
{#if rows.value.length === 0}
  <Placeholder title="还没有角色" body="去「角色」里导入一张角色卡，再来这里和他面对面。" paths={icons.meet} />
{:else}
  <List footer="面对面推剧情：小说写法，他写动作神态和话，你写你说的和做的。和手机聊天共用记忆、状态和时间。">
    {#each rows.value as r (r.character.id)}
      <button class="row" onclick={() => open(r)}>
        <Avatar blob={r.character.avatar} name={r.character.name} size={52} />
        <span class="text">
          <span class="line1"><span class="name">{r.character.name}</span><span class="time">{when(r.ts)}</span></span>
          <span class="last">{r.convId && chat.statusOf(r.convId) !== 'idle' ? '…' : r.last || '写一句开场：在哪，什么情况'}</span>
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
  .time { font-size: 14px; color: var(--label-2); font-variant-numeric: tabular-nums; }
  .last { font-size: 15px; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>

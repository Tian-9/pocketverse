<script lang="ts">
  import { NavBar, Placeholder, Avatar, Glyph, Sheet, List, Cell, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { registry } from '$kernel/registry/registry.svelte';
  import { bus } from '$kernel/bus/bus';
  import { momentsApi, type Post } from './index';

  interface Row extends Post { name: string; avatar?: Blob }
  const rows = live(async (): Promise<Row[]> => {
    if (!registry.isEnabled('moments')) return [];
    const { repo } = await import('$kernel/data/repo');
    const current = await repo.currentCampaignIds();
    const posts = (await momentsApi.posts().reverse().sortBy('createdAt')).filter((p) => current.has(p.campaignId));
    const out: Row[] = [];
    for (const p of posts) { const ch = await db().characters.get(p.characterId); if (ch) out.push({ ...p, name: ch.name, avatar: ch.avatar }); }
    return out;
  }, []);
  const chars = live(() => db().characters.toArray(), []);
  let picking = $state(false);
  let busy = $state(false);
  let commenting = $state<Row | null>(null);
  let draft = $state('');

  function when(ts: number) {
    const d = Date.now() - ts;
    if (d < 60_000) return '刚刚';
    if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
    if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
  async function like(p: Row) { await momentsApi.posts().update(p.id, { liked: !p.liked }); }
  async function comment() {
    const t = draft.trim(); if (!t || !commenting) return;
    await momentsApi.comment(commenting, t);
    draft = ''; commenting = null;
  }
  async function generateFor(characterId: string) {
    picking = false; busy = true;
    try {
      const ch = await db().characters.get(characterId); if (!ch) return;
      const { repo } = await import('$kernel/data/repo');
      const cp = await repo.campaignFor(ch);
      const post = await momentsApi.generate(cp.id, ch.id, '现在想发一条朋友圈。', 'manual');
      if (!post) bus.emit('notify', { title: '没发出来', body: '先在设置里配置 API Key' });
    } catch (e) { bus.emit('notify', { title: '生成失败', body: e instanceof Error ? e.message : String(e) }); }
    finally { busy = false; }
  }
  async function remove(p: Row) { await momentsApi.posts().delete(p.id); }
</script>

<NavBar title="朋友圈" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => (picking = true)} aria-label="让角色发一条" disabled={busy}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if rows.value.length === 0}
  <Placeholder title="还没有动态" body="角色聊到想记录的事会自己发；你离开几小时再回来，他也会发，也会回你的评论。右上角 + 可以现在让他发一条。" paths={icons.clock} />
{:else}
  <div class="feed">
    {#each rows.value as p (p.id)}
      <article class="post">
        <Avatar blob={p.avatar} name={p.name} size={40} />
        <div class="body">
          <div class="name">{p.name}</div>
          <p class="text">{p.text}</p>
          <div class="meta">
            <span>{when(p.createdAt)}{p.source === 'catchup' ? ' · 你不在的时候' : ''}</span>
            <span class="acts">
              <button class:on={p.liked} onclick={() => like(p)} aria-label="赞">{p.liked ? '♥' : '♡'}</button>
              <button onclick={() => (commenting = p)} aria-label="评论">评论</button>
              <button onclick={() => remove(p)} aria-label="删除">删除</button>
            </span>
          </div>
          {#if p.liked || p.comments.length}
            <div class="replies">
              {#if p.liked}<div class="likes">♥ 你</div>{/if}
              {#each p.comments as c, i (i)}<div class="c"><b>{c.by === 'user' ? '你' : p.name}</b>：{c.text}</div>{/each}
              {#if p.pendingReply}<div class="pending">他还没看到</div>{/if}
            </div>
          {/if}
        </div>
      </article>
    {/each}
  </div>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={picking} title="让谁发一条">
  <List>
    {#each chars.value as c (c.id)}<Cell title={c.name} onclick={() => generateFor(c.id)} />{/each}
    {#if !chars.value.length}<Cell title="还没有角色" />{/if}
  </List>
</Sheet>
<Sheet open={!!commenting} onclose={() => (commenting = null)} title="评论">
  <div class="cbox">
    <textarea bind:value={draft} rows="3" placeholder="说点什么"></textarea>
    <button class="send" onclick={comment} disabled={!draft.trim()}>发送</button>
    <button class="cancel" onclick={() => (commenting = null)}>取消</button>
  </div>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .feed { background: var(--bg-surface); margin-top: 8px; }
  .post { display: flex; gap: 12px; padding: 14px 16px; border-bottom: 0.5px solid var(--separator); }
  .body { flex: 1; min-width: 0; }
  .name { font-weight: 600; color: var(--indigo); font-size: 15px; }
  .text { margin: 4px 0 8px; font-size: 16px; line-height: 1.45; white-space: pre-wrap; }
  .meta { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--label-2); }
  .acts { display: flex; gap: 14px; }
  .acts button { color: var(--tint); font-size: 13px; }
  .acts button.on { color: var(--red); }
  .replies { margin-top: 8px; background: var(--bg-grouped); border-radius: 8px; padding: 6px 10px; font-size: 14px; }
  .likes { color: var(--indigo); }
  .c b { color: var(--indigo); font-weight: 600; }
  .pending { font-size: 12px; color: var(--label-3); margin-top: 2px; }
  .cbox { display: flex; flex-direction: column; gap: 10px; padding: 0 16px; }
  textarea { border: 1px solid var(--separator); border-radius: 12px; padding: 10px; background: var(--bg-surface); font-size: 16px; resize: none; outline: 0; }
  .send { background: var(--tint); color: var(--tint-fg); border-radius: 12px; padding: 12px; font-weight: 600; }
  .send:disabled { opacity: 0.4; }
  .cancel { color: var(--tint); padding: 6px; }
</style>

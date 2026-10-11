<script lang="ts">
  /**
   * 论坛首页：一局一个论坛。顶部切存档（只列每张卡当前这一局），列表按最后活跃排。
   * 打开时距上次刷新超过 6 小时就自动让路人发一批；右上角能手动刷、能发帖。
   */
  import { NavBar, Placeholder, Glyph, Sheet, List, Cell, Field, Button, live, nav, icons, clock } from '$kernel/api';
  import type { CampaignView } from '$kernel/api';
  import { forumApi, lastStoryAt, type Thread } from './index';

  const campaigns = live(() => forumApi.ctx().data.currentCampaigns(), []);
  let selected = $state<string | null>(null);
  // 默认上次看的那局，没有就最近玩的
  $effect(() => {
    const list = campaigns.value;
    if (!list.length) { selected = null; return; }
    if (selected && list.some((c) => c.id === selected)) return;
    forumApi.lastCampaign().then((last) => { selected = list.some((c) => c.id === last) ? last : list[0]!.id; });
  });
  const current = $derived<CampaignView | undefined>(campaigns.value.find((c) => c.id === selected));

  interface Row extends Thread { who: string }
  const rows = live(async (): Promise<Row[]> => {
    if (!selected) return [];
    const ts = await forumApi.threads().where('campaignId').equals(selected).reverse().sortBy('lastReplyAt');
    return Promise.all(ts.map(async (t) => ({ ...t, who: await forumApi.nameOf(t.author) })));
  }, [], () => [selected]);

  let busy = $state(false);
  let notice = $state('');
  // 自动刷新：打开或切换存档时，到点了就刷
  $effect(() => {
    const id = selected;
    if (!id) return;
    forumApi.refreshDue(id).then((due) => { if (due) refresh(id, true); });
  });
  async function refresh(id: string, auto = false) {
    if (busy) return;
    if (!forumApi.ctx().llm.configured) { if (!auto) forumApi.ctx().notify('刷不出来', '先在设置里配置 API Key'); return; }
    busy = true; notice = '路人们正在冒泡…';
    try {
      const r = await forumApi.refresh(id);
      notice = r ? (r.posts || r.replies ? `来了 ${r.posts} 个新帖${r.replies ? `，${r.replies} 条回复` : ''}` : '这会儿没人说话') : '';
    } catch (e) { forumApi.ctx().notify('刷新失败', e instanceof Error ? e.message : String(e)); notice = ''; }
    finally { busy = false; setTimeout(() => (notice = ''), 4000); }
  }

  let picking = $state(false);
  let composing = $state(false);
  let title = $state('');
  let body = $state('');
  let nickname = $state('');
  $effect(() => { if (composing) forumApi.nickname().then((n) => (nickname = n)); });
  async function publish() {
    if (!selected || !title.trim() || !body.trim()) return;
    await forumApi.setNickname(nickname);
    const t = await forumApi.post(selected, { kind: 'user' }, title, body, 'user');
    title = ''; body = ''; composing = false;
    nav.push('forum', 'thread', { id: t.id });
  }
  async function pick(c: CampaignView) { selected = c.id; picking = false; await forumApi.setLastCampaign(c.id); }

  // 按这局的剧情钟显示：和真实时间一样的局还是「3 分钟前」，跳过时间或停表的局给剧情时刻
  function when(t: Thread) {
    const ts = lastStoryAt(t);
    if (current && !current.aligned) return clock.formatShort(ts);
    const d = Date.now() - ts;
    if (d < 60_000) return '刚刚';
    if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
    if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
</script>

<NavBar title="论坛" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => selected && refresh(selected)} aria-label="刷新" disabled={busy || !selected}><Glyph paths={icons.sparkle} size={22} color="var(--tint)" width={2} /></button>
    <button class="iconbtn" onclick={() => (composing = true)} aria-label="发帖" disabled={!selected}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if current}
  <button class="where" onclick={() => (picking = true)} aria-label="切换存档">
    <span class="w">{current.worldName}</span><span class="dot">·</span><span>{current.characterName}</span><span class="chev">⌄</span>
  </button>
{/if}
{#if notice}<div class="notice">{notice}</div>{/if}

{#if !current}
  <Placeholder title="还没有论坛" body="先和一个角色聊一句，他所在的世界就有论坛了。" paths={icons.forum} />
{:else if rows.value.length === 0}
  <Placeholder title="还没有帖子" body={busy ? '路人们正在冒泡…' : '右上角 ✦ 让路人发一批，+ 自己发一帖。'} paths={icons.forum} />
{:else}
  <div class="feed">
    {#each rows.value as t (t.id)}
      <button class="thread" onclick={() => nav.push('forum', 'thread', { id: t.id })}>
        <div class="title">{#if t.tag}<span class="tag">{t.tag}</span>{/if}{t.title}</div>
        <p class="snippet">{t.body}</p>
        <div class="meta">
          <span class:me={t.author.kind === 'user'} class:char={t.author.kind === 'char'}>{t.who}</span>
          <span>{when(t)}{t.replyCount ? ` · ${t.replyCount} 回复` : ''}</span>
        </div>
      </button>
    {/each}
  </div>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={picking} title="看哪个世界的论坛">
  <List>
    {#each campaigns.value as c (c.id)}<Cell title={c.worldName} subtitle={c.characterName} onclick={() => pick(c)} />{/each}
  </List>
</Sheet>
<Sheet bind:open={composing} title="发帖">
  <div class="compose">
    <Field bind:value={title} placeholder="标题" />
    <Field bind:value={body} multiline rows={5} placeholder="想说什么" />
    <Field label="网名" bind:value={nickname} placeholder="路过的人" />
    <Button onclick={publish} disabled={!title.trim() || !body.trim()}>发布</Button>
  </div>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .where { display: flex; align-items: center; gap: 6px; margin: 0 16px 8px; font-size: 14px; color: var(--label-2); }
  .where .w { color: var(--label); font-weight: 600; }
  .where .chev { margin-left: 2px; }
  .notice { margin: 0 16px 8px; font-size: 13px; color: var(--label-2); }
  .feed { background: var(--bg-surface); }
  .thread { display: block; width: 100%; text-align: left; padding: 12px 16px; border-bottom: 0.5px solid var(--separator); }
  .thread:active { background: var(--fill-2); }
  .title { font-size: 16px; font-weight: 600; line-height: 1.35; }
  .tag { display: inline-block; font-size: 11px; font-weight: 500; color: var(--tint); background: var(--fill-2); border-radius: 4px; padding: 1px 5px; margin-right: 6px; vertical-align: 2px; }
  .snippet { margin: 4px 0 6px; font-size: 14px; color: var(--label-2); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--label-3); }
  .meta .me { color: var(--tint); }
  .meta .char { color: var(--indigo); }
  .compose { display: flex; flex-direction: column; gap: 10px; padding: 0 16px; }
</style>

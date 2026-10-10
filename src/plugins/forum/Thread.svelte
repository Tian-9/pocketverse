<script lang="ts">
  /** 帖子页：正文 + 回复 + 回复框。你回完可以点「看看有没有人回」让路人现在接话。 */
  import { NavBar, Placeholder, Button, live, nav, icons } from '$kernel/api';
  import { forumApi, type Thread, type Reply } from './index';

  let { id }: { id: string } = $props();
  const thread = live(() => forumApi.threads().get(id), undefined as Thread | undefined, () => [id]);
  interface Row extends Reply { who: string }
  const replies = live(async (): Promise<Row[]> => {
    const rs = await forumApi.replies().where('threadId').equals(id).sortBy('createdAt');
    return Promise.all(rs.map(async (r) => ({ ...r, who: await forumApi.nameOf(r.author) })));
  }, [], () => [id]);
  const who = live(() => (thread.value ? forumApi.nameOf(thread.value.author) : Promise.resolve('')), '', () => [thread.value?.author]);

  let draft = $state('');
  let busy = $state(false);
  async function send() {
    const t = thread.value; const text = draft.trim();
    if (!t || !text) return;
    await forumApi.reply(t, { kind: 'user' }, text);
    draft = '';
  }
  async function poke() {
    const t = thread.value; if (!t || busy) return;
    if (!forumApi.ctx().llm.configured) { forumApi.ctx().notify('叫不来人', '先在设置里配置 API Key'); return; }
    busy = true;
    try {
      const r = await forumApi.refresh(t.campaignId, { threadId: t.id });
      if (r && !r.replies) forumApi.ctx().notify('暂时没人回', '过会儿再看看');
    } catch (e) { forumApi.ctx().notify('没叫来人', e instanceof Error ? e.message : String(e)); }
    finally { busy = false; }
  }
  async function remove() {
    if (!thread.value) return;
    await forumApi.remove(thread.value.id);
    await nav.pop();
  }
  const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const cls = (a: Reply['author'] | Thread['author']) => (a.kind === 'user' ? 'me' : a.kind === 'char' ? 'char' : '');
</script>

<NavBar title="帖子" back="论坛" />

{#if !thread.value}
  <Placeholder title="帖子不见了" body="可能被删了。" paths={icons.forum} />
{:else}
  {@const t = thread.value}
  <article class="post">
    <h2 class="title">{#if t.tag}<span class="tag">{t.tag}</span>{/if}{t.title}</h2>
    <div class="by"><span class={cls(t.author)}>{who.value}</span><span>{fmt(t.createdAt)}</span></div>
    <p class="body">{t.body}</p>
  </article>

  <div class="replies">
    {#each replies.value as r, i (r.id)}
      <div class="reply">
        <div class="rhead"><span class="floor">{i + 1}楼</span><span class={cls(r.author)}>{r.who}</span><span class="t">{fmt(r.createdAt)}</span></div>
        <p>{r.body}</p>
      </div>
    {:else}
      <div class="empty">还没有人回复</div>
    {/each}
  </div>

  <div class="actions">
    {#if t.awaitingCrowd || !replies.value.length}
      <Button kind="tinted" onclick={poke} disabled={busy}>{busy ? '叫人中…' : '看看有没有人回'}</Button>
    {/if}
    <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除这帖</span></Button>
  </div>

  <div class="composer">
    <textarea bind:value={draft} rows="2" placeholder="回一句"></textarea>
    <button class="send" onclick={send} disabled={!draft.trim()}>发送</button>
  </div>
{/if}

<style>
  .post { background: var(--bg-surface); padding: 14px 16px; }
  .title { margin: 0; font-size: 19px; font-weight: 700; line-height: 1.35; }
  .tag { display: inline-block; font-size: 12px; font-weight: 500; color: var(--tint); background: var(--fill-2); border-radius: 4px; padding: 1px 6px; margin-right: 6px; vertical-align: 3px; }
  .by { display: flex; gap: 10px; margin-top: 6px; font-size: 13px; color: var(--label-3); }
  .by span:first-child { color: var(--label-2); font-weight: 500; }
  .body { margin: 12px 0 0; font-size: 16px; line-height: 1.55; white-space: pre-wrap; }
  .replies { background: var(--bg-surface); margin-top: 10px; }
  .reply { padding: 12px 16px; border-bottom: 0.5px solid var(--separator); }
  .reply p { margin: 6px 0 0; font-size: 15px; line-height: 1.5; white-space: pre-wrap; }
  .rhead { display: flex; gap: 8px; font-size: 13px; color: var(--label-3); align-items: baseline; }
  .rhead span:nth-child(2) { color: var(--label-2); font-weight: 500; }
  .floor { font-variant-numeric: tabular-nums; }
  .t { margin-left: auto; }
  .empty { padding: 20px 16px; text-align: center; font-size: 14px; color: var(--label-3); }
  .me { color: var(--tint) !important; }
  .char { color: var(--indigo) !important; }
  .actions { display: flex; justify-content: center; gap: 8px; padding: 14px 16px 0; flex-wrap: wrap; }
  .composer { display: flex; gap: 8px; padding: 14px 16px 30px; align-items: flex-end; }
  textarea { flex: 1; border: 1px solid var(--separator); border-radius: 12px; padding: 10px; background: var(--bg-surface); font-size: 16px; resize: none; outline: 0; }
  .send { background: var(--tint); color: var(--tint-fg); border-radius: 12px; padding: 10px 14px; font-weight: 600; }
  .send:disabled { opacity: 0.4; }
</style>

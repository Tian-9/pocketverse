<script lang="ts">
  /** 「+」面板 → 帖子：挑这一局论坛里的一帖，附一句，发给他 */
  import { List, Cell, Button, Field, ShareCardView, live } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  import { forumApi, type Thread } from './index';
  import { buildCard, forModel } from './share';
  let { campaignId, onsend, onclose }: ComposerActionProps = $props();
  const threads = live(() => forumApi.threads().where('campaignId').equals(campaignId).reverse().sortBy('lastReplyAt').then((xs) => xs.slice(0, 30)), [] as Thread[], () => [campaignId]);
  let picked = $state<{ thread: Thread; who: string } | null>(null);
  let note = $state('');
  async function pick(t: Thread) { picked = { thread: t, who: await forumApi.nameOf(t.author) }; }
  async function send() {
    const p = picked; if (!p) return;
    const t = p.thread;
    const replies = await forumApi.replies().where('threadId').equals(t.id).sortBy('createdAt');
    onsend({ text: `[分享了一个论坛帖子]\n${await forModel(t, replies)}`, cards: [{ tag: 'share', body: JSON.stringify(buildCard(t, p.who)), alt: `[帖子] ${t.title}` }], cardOnly: true, note: note.trim().slice(0, 60) || undefined });
  }
</script>

{#if !picked}
  <List footer="他会看到帖子全文和最近几条回复。">
    {#each threads.value as t (t.id)}
      <Cell title={t.title} subtitle={`${t.replyCount} 回复 · ${t.body.replace(/\s+/g, ' ').slice(0, 40)}`} onclick={() => pick(t)} />
    {:else}
      <Cell title="这一局的论坛还没有帖子" />
    {/each}
  </List>
  <div class="actions"><Button kind="plain" onclick={onclose}>取消</Button></div>
{:else}
  <div class="preview"><ShareCardView body={JSON.stringify(buildCard(picked.thread, picked.who))} /></div>
  <List><Field label="留言" bind:value={note} placeholder="附一句给他，可不填" /></List>
  <div class="actions">
    <Button onclick={send}>发给他</Button>
    <Button kind="plain" onclick={() => (picked = null)}>换一帖</Button>
  </div>
{/if}

<style>
  .preview { display: flex; justify-content: center; margin: 12px 16px 0; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

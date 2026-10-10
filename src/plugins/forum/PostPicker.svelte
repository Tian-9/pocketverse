<script lang="ts">
  /** 「+」面板 → 帖子：挑这一局论坛里的一帖发给他 */
  import { List, Cell, Button, live } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  import { forumApi, type Thread } from './index';
  import { buildCard, forModel } from './share';
  let { campaignId, onsend, onclose }: ComposerActionProps = $props();
  const threads = live(() => forumApi.threads().where('campaignId').equals(campaignId).reverse().sortBy('lastReplyAt').then((xs) => xs.slice(0, 30)), [] as Thread[], () => [campaignId]);
  async function pick(t: Thread) {
    const replies = await forumApi.replies().where('threadId').equals(t.id).sortBy('createdAt');
    const who = await forumApi.nameOf(t.author);
    const card = buildCard(t, who);
    onsend({ text: `[分享了一个论坛帖子]\n${await forModel(t, replies)}`, cards: [{ tag: 'share', body: JSON.stringify(card), alt: `[帖子] ${t.title}` }], cardOnly: true });
  }
</script>

<List footer="他会看到帖子全文和最近几条回复。">
  {#each threads.value as t (t.id)}
    <Cell title={t.title} subtitle={`${t.replyCount} 回复 · ${t.body.replace(/\s+/g, ' ').slice(0, 40)}`} onclick={() => pick(t)} />
  {:else}
    <Cell title="这一局的论坛还没有帖子" />
  {/each}
</List>
<div class="actions"><Button kind="plain" onclick={onclose}>取消</Button></div>

<style>
  .actions { display: flex; justify-content: center; margin: 12px 16px 0; }
</style>

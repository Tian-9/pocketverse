<script lang="ts">
  /** 「+」面板 → 歌曲：输入歌名歌手，查到后预览，发给角色 */
  import { List, Field, Button, ShareCardView } from '$kernel/api';
  import type { ComposerActionProps, ShareCard } from '$kernel/api';
  import { lookupSong } from './lookup';
  let { onsend, onclose }: ComposerActionProps = $props();
  let title = $state('');
  let artist = $state('');
  let busy = $state(false);
  let card = $state<ShareCard | null>(null);
  let note = $state('');
  async function find() {
    if (!title.trim() || busy) return;
    busy = true; card = null; note = '';
    try {
      const r = await lookupSong({ type: 'music', title: title.trim(), subtitle: artist.trim() || undefined });
      card = r.card;
      note = r.card.source === 'none' ? '没查到这首歌的资料，会按你写的名字发出去。' : r.card.extra?.lyricsHead ? '' : '查到了，但没有歌词。';
    } finally { busy = false; }
  }
  function send() {
    if (!card) return;
    const head = card.extra?.lyricsHead as string | undefined;
    const text = `[分享了一首歌：《${card.title}》${card.subtitle ? ' - ' + card.subtitle : ''}]${head ? '\n歌词开头：\n' + head : ''}`;
    onsend({ text, cards: [{ tag: 'share', body: JSON.stringify(card), alt: `[歌曲] ${card.title}${card.subtitle ? ' - ' + card.subtitle : ''}` }], cardOnly: true });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); find(); } }} role="presentation">
  <List footer="查封面、试听和歌词都在你手机上直接查，不经过模型。发出去后他会看到歌名和歌词开头。">
    <Field label="歌名" bind:value={title} placeholder="晴天" />
    <Field label="歌手" bind:value={artist} placeholder="可选" />
  </List>
</div>
{#if card}
  <div class="preview"><ShareCardView body={JSON.stringify(card)} /></div>
{/if}
{#if note}<p class="note">{note}</p>{/if}
<div class="actions">
  {#if card}
    <Button onclick={send}>发给他</Button>
    <Button kind="tinted" onclick={find}>重新查</Button>
  {:else}
    <Button onclick={find}>{busy ? '查找中…' : '查找'}</Button>
  {/if}
  <Button kind="plain" onclick={onclose}>取消</Button>
</div>

<style>
  .preview { display: flex; justify-content: center; margin: 12px 16px 0; }
  .note { margin: 8px 32px 0; font-size: 13px; color: var(--label-2); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

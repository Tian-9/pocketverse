<script lang="ts">
  /** 通用分享卡：按字段有无决定显示什么。body 是 ShareCard 的 JSON。 */
  import type { ShareCard } from '../share/types';
  import Glyph from './Glyph.svelte';
  import { onDestroy } from 'svelte';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
  const card = $derived.by<ShareCard>(() => { try { return JSON.parse(body); } catch { return { type: 'link', title: body }; } });
  const KIND: Record<string, string> = { music: '分享歌曲', movie: '分享电影', book: '分享书', news: '分享新闻', link: '分享链接' };
  const kind = $derived(KIND[card.type] ?? '分享');

  let audio: HTMLAudioElement | null = null;
  let playing = $state(false);
  function toggle() {
    if (!card.preview) return;
    if (!audio) {
      audio = new Audio(card.preview);
      audio.addEventListener('ended', () => (playing = false));
      audio.addEventListener('pause', () => (playing = false));
      audio.addEventListener('play', () => (playing = true));
    }
    if (audio.paused) audio.play().catch(() => (playing = false)); else audio.pause();
  }
  onDestroy(() => { audio?.pause(); audio = null; });
</script>

<div class="share">
  <span class="k"><Glyph paths={['M9 18V5l12-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']} size={12} width={2.2} /> {kind}</span>
  <div class="head">
    {#if card.cover}<img class="cover" src={card.cover} alt="" loading="lazy" />{/if}
    <div class="info">
      <div class="t">{card.title}</div>
      {#if card.subtitle}<div class="s">{card.subtitle}</div>{/if}
    </div>
    {#if card.preview}
      <button class="play" onclick={toggle} aria-label={playing ? '暂停' : '试听'}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" aria-hidden="true">
          {#if playing}<path d="M6 5h4v14H6z" /><path d="M14 5h4v14h-4z" />{:else}<path d="M8 4l13 8-13 8z" />{/if}
        </svg>
      </button>
    {/if}
  </div>
  {#if card.quote}<div class="q">“{card.quote}”</div>{/if}
  {#if card.excerpt}<div class="e">{card.excerpt}</div>{/if}
  {#if card.links?.length}
    <div class="links">{#each card.links as l (l.url)}<a href={l.url} target="_blank" rel="noopener">{l.label}</a>{/each}</div>
  {/if}
</div>

<style>
  .share { background: var(--bg-surface); border: 0.5px solid var(--separator); border-radius: 14px; padding: 10px 12px; width: 260px; max-width: 100%; }
  .k { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--tint); font-weight: 600; letter-spacing: 0.02em; }
  .head { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .cover { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; background: var(--fill-2); flex-shrink: 0; }
  .info { flex: 1; min-width: 0; }
  .t { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s { font-size: 13px; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .play { width: 32px; height: 32px; border-radius: 50%; background: var(--tint); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .q { margin-top: 8px; font-size: 14px; line-height: 1.4; color: var(--label); font-style: italic; white-space: pre-wrap; }
  .e { margin-top: 6px; font-size: 13px; line-height: 1.4; color: var(--label-2); white-space: pre-wrap; }
  .links { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; }
  .links a { color: var(--tint); }
</style>

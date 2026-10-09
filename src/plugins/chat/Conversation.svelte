<script lang="ts">
  import { NavBar, Sheet, List, Cell, Avatar, Glyph, Field, Button, ShareCardView, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import type { Message } from '$kernel/storage/db';
  import { repo, textOf } from '$kernel/data/repo';
  import { chat } from '$kernel/chat/engine.svelte';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { tick } from 'svelte';
  import { toolLabel } from '$kernel/context/tools';
  import { registry } from '$kernel/registry/registry.svelte';

  let { id }: { id: string } = $props();
  const conv = live(() => db().conversations.get(id), undefined);
  const character = live(async () => { const c = await db().conversations.get(id); return c ? repo.characterOfConversation(c) : undefined; }, undefined);
  const messages = live(() => repo.messagesOf(id), [] as Message[]);
  const liveTurn = $derived(chat.live[id]);
  const status = $derived(liveTurn?.status ?? 'idle');

  let draft = $state('');
  let menu = $state(false);
  let timeSheet = $state(false);
  let timeWhen = $state('');
  let timeNote = $state('');
  function advance() {
    const w = timeWhen.trim(); if (!w) return;
    timeSheet = false;
    chat.advanceTime(id, w, timeNote.trim() || undefined);
    timeWhen = ''; timeNote = '';
  }
  let picked = $state<Message | null>(null);
  let scroller: HTMLDivElement;
  let textarea: HTMLTextAreaElement;

  $effect(() => {
    // 任何消息或流式文本变化都滚到底
    void messages.value.length; void liveTurn?.text;
    tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });

  async function send() {
    const t = draft.trim();
    if (!t || status !== 'idle') return;
    if (!llm.configured) { nav.push('settings', 'api'); return; }
    draft = '';
    textarea.style.height = 'auto';
    await chat.send(id, t);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  }
  function grow() { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px'; }

  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  function pressStart(m: Message) { pressTimer = setTimeout(() => (picked = m), 450); }
  function pressEnd() { clearTimeout(pressTimer); }
  async function copyPicked() {
    if (picked) try { await navigator.clipboard.writeText(textOf(picked)); } catch { /* ignore */ }
    picked = null;
  }
  async function deletePicked() { if (picked) await chat.deleteMessage(picked.id); picked = null; }
  async function clearAll() {
    for (const m of messages.value) await chat.deleteMessage(m.id);
    const ch = character.value;
    if (ch?.useFirstMessage && ch.firstMessage) await repo.addMessage(id, 'assistant', ch.firstMessage);
    menu = false;
  }
  interface Card { pluginId: string; tag: string; body: string; attrs: Record<string, string> }
  function cardsOf(m: Message): Card[] { return (m.meta?.cards as Card[] | undefined) ?? []; }
  function cardComponent(c: Card) {
    if (c.pluginId === 'kernel' && c.tag === 'share') return ShareCardView;
    return registry.get(c.pluginId)?.outputHandlers?.find((h) => h.tag === c.tag)?.component ?? null;
  }
  let openThinking = $state<Record<string, boolean>>({});
  function caption(m: Message): string {
    const meta = m.meta ?? {};
    const parts: string[] = [];
    const lore = meta.lore as string[] | undefined;
    const tools = meta.tools as string[] | undefined;
    if (lore?.length) parts.push('触发世界书：' + lore.join('、'));
    if (tools?.length) parts.push('用了 ' + [...new Set(tools)].map(toolLabel).join('、'));
    return parts.join(' · ');
  }
  function fmt(ts: number) { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function showTime(i: number) {
    const m = messages.value[i]!, p = messages.value[i - 1];
    if (!p) return true;
    if (m.inWorldTs || p.inWorldTs) return m.inWorldTs !== p.inWorldTs; // 剧情时间变了才显示
    return m.ts - p.ts > 10 * 60 * 1000;
  }
  function timeLabel(m: Message) { return m.inWorldTs ?? fmt(m.ts); }
</script>

<div class="conv">
  <NavBar title={character.value?.name ?? '…'} back="信息">
    {#snippet right()}
      <button class="iconbtn" onclick={() => (menu = true)} aria-label="更多"><Glyph paths={['M5 12h.01M12 12h.01M19 12h.01']} size={22} color="var(--tint)" width={3} /></button>
    {/snippet}
  </NavBar>
  <div class="status">{liveTurn?.statusText ?? ' '}</div>

  <div class="msgs" bind:this={scroller}>
    {#each messages.value as m, i (m.id)}
      {#if showTime(i)}<div class="time">{timeLabel(m)}</div>{/if}
      {#if m.role === 'system' || m.meta?.narration}
        <div class="sys">{textOf(m)}</div>
      {:else}
        <div class="msg {m.role}" onpointerdown={() => pressStart(m)} onpointerup={pressEnd} onpointerleave={pressEnd} onpointercancel={pressEnd} oncontextmenu={(e) => { e.preventDefault(); picked = m; }} role="listitem">
          {#if m.role === 'assistant' && character.value}<Avatar blob={character.value.avatar} name={character.value.name} size={30} />{/if}
          <div class="col">
            {#if textOf(m)}<div class="bubble">{textOf(m)}</div>{/if}
            {#each cardsOf(m) as c, i (i)}
              {@const Card = cardComponent(c)}
              {#if Card}<Card body={c.body} attrs={c.attrs} />{/if}
            {/each}
            {#if caption(m)}<div class="caption">{caption(m)}</div>{/if}
            {#if m.meta?.thinking}
              <button class="think-toggle" onclick={() => (openThinking[m.id] = !openThinking[m.id])}>{openThinking[m.id] ? '收起' : '他在想什么 ›'}</button>
              {#if openThinking[m.id]}<div class="think">{m.meta.thinking}</div>{/if}
            {/if}
          </div>
        </div>
      {/if}
    {/each}
    {#if liveTurn}
      <div class="msg assistant">
        {#if character.value}<Avatar blob={character.value.avatar} name={character.value.name} size={30} />{/if}
        {#if liveTurn.text}<div class="bubble">{liveTurn.text}</div>{:else}<div class="bubble dots"><i></i><i></i><i></i></div>{/if}
      </div>
    {/if}
  </div>

  <div class="composer">
    <textarea bind:this={textarea} bind:value={draft} placeholder="信息" rows="1" oninput={grow} onkeydown={onKey} enterkeyhint="send"></textarea>
    {#if status !== 'idle'}
      <button class="send stop" onclick={() => chat.stop(id)} aria-label="停止"><span></span></button>
    {:else}
      <button class="send" onclick={send} disabled={!draft.trim()} aria-label="发送"><Glyph paths={['M12 19V5', 'm5 12 7-7 7 7']} size={20} color="#fff" width={2.6} /></button>
    {/if}
  </div>
</div>

<Sheet bind:open={menu} title={character.value?.name}>
  <List>
    <Cell title="重新生成最后一条" onclick={() => { menu = false; chat.regenerate(id); }} />
    <Cell title="推进时间…" subtitle="比如「三天后的早上」，角色会接着这个时间点说话" onclick={() => { menu = false; timeSheet = true; }} />
    <Cell title="编辑角色" onclick={() => { menu = false; if (character.value) nav.push('characters', 'detail', { id: character.value.id }); }} />
    <Cell title="他记得什么" onclick={() => { menu = false; if (character.value) nav.push('characters', 'memories', { id: character.value.id }); }} />
    <Cell title="清空对话" onclick={clearAll} />
  </List>
</Sheet>
<Sheet bind:open={timeSheet} title="推进时间">
  <div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); advance(); } }} role="presentation">
  <List footer="会在对话里插一条旁白，并把剧情时间更新成你写的。真实时间模式下也能用，只是下一轮角色仍会看到真实时钟；想完全按剧情走，去角色页打开「剧情时间模式」。">
    <Field label="来到" bind:value={timeWhen} placeholder="三天后的早上" />
    <Field multiline rows={2} bind:value={timeNote} placeholder="这段时间发生了什么，可选" />
  </List>
  <div class="actions"><Button onclick={advance}>推进</Button></div>
  </div>
</Sheet>
<Sheet open={!!picked} onclose={() => (picked = null)} title="这条消息">
  <List>
    <Cell title="复制" onclick={copyPicked} />
    <Cell title="删除" onclick={deletePicked} />
    <Cell title="取消" onclick={() => (picked = null)} />
  </List>
</Sheet>

<style>
  .conv { display: flex; flex-direction: column; height: 100%; }
  .conv :global(.nav) { background: var(--bg-surface); border-bottom: 0; }
  .status { font-size: 12px; color: var(--label-2); text-align: center; height: 16px; line-height: 16px; background: var(--bg-surface); border-bottom: 0.5px solid var(--separator); }
  .iconbtn { padding: 8px; display: inline-flex; }
  .msgs { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; background: var(--bg-surface); }
  .time { align-self: center; font-size: 11px; color: var(--label-2); margin: 10px 0 4px; }
  .sys { align-self: center; font-size: 12px; color: var(--label-2); background: var(--fill-2); padding: 3px 10px; border-radius: 999px; margin: 4px 0; max-width: 90%; text-align: center; }
  .msg { display: flex; align-items: flex-end; gap: 6px; max-width: 80%; }
  .msg.user { align-self: flex-end; }
  .msg.assistant { align-self: flex-start; }
  .col { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .caption { font-size: 11px; color: var(--label-3); padding-left: 6px; }
  .think-toggle { font-size: 11px; color: var(--tint); padding: 0 6px; text-align: left; }
  .think { font-size: 12.5px; line-height: 1.45; color: var(--label-2); background: var(--bg-grouped); border-radius: 10px; padding: 8px 10px; white-space: pre-wrap; max-width: 100%; }
  .bubble { padding: 8px 13px; border-radius: 18px; font-size: 17px; line-height: 1.35; white-space: pre-wrap; word-break: break-word; min-width: 0; }
  .assistant .bubble { background: var(--bubble-them); color: var(--bubble-them-fg); border-bottom-left-radius: 5px; }
  .user .bubble { background: var(--bubble-me); color: var(--bubble-me-fg); border-bottom-right-radius: 5px; }
  .dots { display: flex; gap: 4px; padding: 12px 14px; }
  .dots i { width: 8px; height: 8px; border-radius: 4px; background: var(--label-2); opacity: 0.4; animation: blink 1.2s infinite; }
  .dots i:nth-child(2) { animation-delay: 0.2s; } .dots i:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.25 } 40% { opacity: 0.9 } }
  .composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px 12px calc(var(--safe-bottom) + 8px); background: var(--bg-grouped); border-top: 0.5px solid var(--separator); }
  textarea { flex: 1; min-width: 0; resize: none; border: 1px solid var(--separator); border-radius: 18px; background: var(--bg-surface); padding: 8px 14px; font-size: 17px; line-height: 1.3; max-height: 140px; outline: 0; }
  .send { width: 34px; height: 34px; border-radius: 17px; background: var(--tint); display: grid; place-items: center; flex: 0 0 auto; margin-bottom: 1px; }
  .send:disabled { background: var(--fill); }
  .send.stop { background: var(--label); }
  .actions { display: flex; flex-direction: column; margin: 12px 16px 0; }
  .send.stop span { width: 12px; height: 12px; border-radius: 2px; background: var(--bg-surface); }
</style>

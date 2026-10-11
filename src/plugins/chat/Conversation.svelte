<script lang="ts">
  import { NavBar, Sheet, List, Cell, Avatar, Glyph, Icon, Field, Button, ShareCardView, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import type { Message } from '$kernel/storage/db';
  import { repo, textOf, cardsOf, quoteOf, noteOf, withNote, type MessageQuote } from '$kernel/data/repo';
  import { chat } from '$kernel/chat/engine.svelte';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { tick } from 'svelte';
  import { toolLabel } from '$kernel/context/tools';
  import { registry } from '$kernel/registry/registry.svelte';
  import { theme } from '$kernel/theme/theme.svelte';
  import { clock } from '$kernel/context/clock';
  import { chatCtx } from './ctx';
  import type { ComposerAction, OutgoingMessage, MessageCard } from '$kernel/api';

  // 从别的插件（日历）过来时只带 campaignId：找这局的私聊；skipTo 是要推进到的时刻，进来就打开推进面板
  let { id: givenId, campaignId: fromCampaign, skipTo }: { id?: string; campaignId?: string; skipTo?: number } = $props();
  let resolved = $state<string | null>(null);
  $effect(() => {
    if (givenId || !fromCampaign) return;
    db().campaigns.get(fromCampaign).then(async (cp) => {
      const ch = cp?.characterIds[0] ? await db().characters.get(cp.characterIds[0]) : undefined;
      if (ch) resolved = (await repo.directConversation(ch)).id;
    });
  });
  const id = $derived(givenId ?? resolved ?? '');
  const conv = live(() => (id ? db().conversations.get(id) : Promise.resolve(undefined)), undefined, () => [id]);
  const character = live(async () => { const c = id ? await db().conversations.get(id) : undefined; return c ? repo.characterOfConversation(c) : undefined; }, undefined, () => [id]);
  const messages = live(() => (id ? repo.messagesOf(id) : Promise.resolve([] as Message[])), [] as Message[], () => [id]);
  const campaign = live(async () => { const c = id ? await db().conversations.get(id) : undefined; return c ? db().campaigns.get(c.campaignId) : undefined; }, undefined, () => [id]);
  const liveTurn = $derived(chat.live[id]);
  const status = $derived(liveTurn?.status ?? 'idle');

  let draft = $state('');
  let menu = $state(false);
  // 「+」面板：插件登记的动作（歌曲、红包…）
  let panel = $state(false);
  type Action = ComposerAction & { pluginId: string };
  const actions = $derived<Action[]>(registry.plugins.filter((p) => registry.isEnabled(p.id)).flatMap((p) => (p.composerActions ?? []).map((a) => ({ ...a, pluginId: p.id }))));
  let active = $state<Action | null>(null);
  async function sendOutgoing(a: Action, msg: OutgoingMessage) {
    active = null; panel = false;
    if (!llm.configured) { nav.push('settings', 'api'); return; }
    // 事件（撤回、拍一拍）：一行小灰字，text 只给模型看
    if (msg.narration) { await chat.send(id, msg.narration, { meta: { narration: true, modelText: msg.text } }); return; }
    const meta: Record<string, unknown> = {};
    if (msg.cards?.length) meta.cards = msg.cards.map((c): MessageCard => ({ pluginId: a.pluginId, tag: c.tag, body: c.body, attrs: c.attrs ?? {}, ...(c.alt ? { alt: c.alt } : {}) }));
    if (msg.cardOnly) meta.cardOnly = true;
    // 随卡片说的一句：单独存着给界面当气泡，模型看到的 text 后面接一行
    const note = msg.note?.trim();
    if (note) meta.note = note;
    await chat.send(id, withNote(msg.text, note), Object.keys(meta).length ? { meta } : {});
  }
  const wechat = $derived(theme.chatStyle === 'wechat');
  // 推进时间：快捷项按这局的钟算，也能自己选一个时刻
  let timeSheet = $state(false);
  let timeWhen = $state('');
  let timeNote = $state('');
  const H = 3600_000, D = 24 * H;
  const storyNow = () => clock.now(campaign.value?.clock);
  const at = (base: number, dayOffset: number, hour: number) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.getTime(); };
  const quick = $derived.by(() => {
    const n = storyNow();
    const tonight = at(n, 0, 20);
    return [
      { label: '一小时后', ts: n + H },
      { label: '今晚', ts: tonight > n ? tonight : at(n, 1, 20) },
      { label: '明早', ts: at(n, 1, 8) },
      { label: '三天后', ts: at(n, 3, 9) },
      { label: '下周', ts: at(n, 7, 9) },
    ];
  });
  function openTimeSheet(at = storyNow() + H) { timeWhen = clock.toInput(at); loadNext(); timeSheet = true; }
  // 日历插件开着就多一个快捷项：到下一个安排
  interface NextEvent { start: number; title: string }
  interface CalendarService { next(campaignId: string, now: number): Promise<NextEvent | undefined> }
  let nextEvent = $state<NextEvent | null>(null);
  async function loadNext() {
    nextEvent = null;
    const cp = campaign.value; const svc = chatCtx?.service<CalendarService>('calendar');
    if (!cp || !svc) return;
    try { nextEvent = (await svc.next(cp.id, storyNow())) ?? null; } catch { nextEvent = null; }
  }
  let skipHandled = false;
  $effect(() => { if (skipTo && campaign.value && !skipHandled) { skipHandled = true; openTimeSheet(skipTo); } });
  function advance(ts?: number) {
    const to = ts ?? clock.fromInput(timeWhen);
    if (to === null) return;
    timeSheet = false;
    chat.advanceTime(id, to, timeNote.trim() || undefined);
    timeWhen = ''; timeNote = '';
  }
  let picked = $state<Message | null>(null);
  // 引用：长按一条 → 「引用」，输入框上方出现引用条，随下一条文字消息发出去。存的是原文截断，原消息撤回了也还显示
  let quoting = $state<MessageQuote | null>(null);
  function quoteLabel(q: MessageQuote) { return (q.role === 'assistant' ? character.value?.name ?? '他' : chat.userName) + '：' + q.text; }
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
    // $state 对象是 Proxy，写库前要 snapshot
    const q = quoting ? $state.snapshot(quoting) : null; quoting = null;
    await chat.send(id, t, q ? { meta: { quote: q } } : {});
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
  function quotePicked() {
    if (picked) quoting = { id: picked.id, role: picked.role, text: textOf(picked).trim().replace(/\s+/g, ' ').slice(0, 80) };
    picked = null; textarea?.focus();
  }
  /** 点头像进他的主页（角色插件的 profile 页） */
  function openProfile() { if (character.value) nav.push('characters', 'profile', { id: character.value.id }); }
  async function clearAll() {
    for (const m of messages.value) await chat.deleteMessage(m.id);
    const ch = character.value;
    if (ch?.useFirstMessage && ch.firstMessage) await repo.addMessage(id, 'assistant', ch.firstMessage);
    menu = false;
  }
  function cardComponent(c: MessageCard) {
    if (c.tag === 'share') return ShareCardView;
    return registry.get(c.pluginId)?.outputHandlers?.find((h) => h.tag === c.tag)?.component ?? null;
  }
  let openThinking = $state<Record<string, boolean>>({});
  function caption(m: Message): string {
    const meta = m.meta ?? {};
    const parts: string[] = [];
    const lore = meta.lore as string[] | undefined;
    const tools = meta.tools as string[] | undefined;
    if (lore?.length) parts.push('触发设定：' + lore.join('、'));
    if (tools?.length) parts.push('用了 ' + [...new Set(tools)].map(toolLabel).join('、'));
    return parts.join(' · ');
  }
  // 分隔线按剧情时刻：隔了十分钟以上就显示；不是今天的（或跳过了时间的）带日期
  const tsOf = (m: Message) => m.storyTs ?? m.ts;
  function showTime(i: number) {
    const m = messages.value[i]!, p = messages.value[i - 1];
    if (!p) return true;
    return tsOf(m) - tsOf(p) > 10 * 60 * 1000 || !!m.meta?.chapter;
  }
  function timeLabel(m: Message) {
    const t = tsOf(m), tz = character.value?.timeZone;
    if (clock.dateKey(t, tz) === clock.dateKey(Date.now(), tz) && clock.aligned(campaign.value?.clock)) return new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) });
    return clock.formatShort(t, tz);
  }
</script>

<div class="conv" class:wechat>
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
          {#if m.role === 'assistant' && character.value}<button class="avatar-btn" onclick={openProfile} aria-label="他的主页"><Avatar blob={character.value.avatar} name={character.value.name} size={wechat ? 36 : 30} /></button>{/if}
          <div class="col">
            {#if textOf(m) && !m.meta?.cardOnly}<div class="bubble">{textOf(m)}</div>{/if}
            {#if quoteOf(m)}{@const q = quoteOf(m)!}<div class="quote">{quoteLabel(q)}</div>{/if}
            {#each cardsOf(m) as c, i (i)}
              {@const Card = cardComponent(c)}
              {#if Card}<Card body={c.body} attrs={c.attrs} />{/if}
            {/each}
            {#if noteOf(m)}<div class="bubble">{noteOf(m)}</div>{/if}
            {#if caption(m)}<div class="caption">{caption(m)}</div>{/if}
            {#if m.meta?.thinking}
              <button class="think-toggle" onclick={() => (openThinking[m.id] = !openThinking[m.id])}>{openThinking[m.id] ? '收起' : '他在想什么 ›'}</button>
              {#if openThinking[m.id]}<div class="think">{m.meta.thinking}</div>{/if}
            {/if}
          </div>
          {#if m.role === 'user' && wechat}<Avatar name={chat.userName} size={36} />{/if}
        </div>
      {/if}
    {/each}
    {#if liveTurn}
      <div class="msg assistant">
        {#if character.value}<Avatar blob={character.value.avatar} name={character.value.name} size={wechat ? 36 : 30} />{/if}
        {#if liveTurn.text}<div class="bubble">{liveTurn.text}</div>{:else}<div class="bubble dots"><i></i><i></i><i></i></div>{/if}
      </div>
    {/if}
  </div>

  {#if quoting}
    <div class="quoting"><span class="qtext">{quoteLabel(quoting)}</span><button class="qclose" onclick={() => (quoting = null)} aria-label="取消引用">✕</button></div>
  {/if}
  <div class="composer">
    {#if actions.length}
      <button class="plus" class:open={panel} onclick={() => (panel = !panel)} aria-label="更多功能"><Glyph paths={icons.plus} size={22} color={wechat ? 'var(--label)' : 'var(--tint)'} width={2.2} /></button>
    {/if}
    <textarea bind:this={textarea} bind:value={draft} placeholder={wechat ? '' : '信息'} rows="1" oninput={grow} onkeydown={onKey} onfocus={() => (panel = false)} enterkeyhint="send"></textarea>
    {#if status !== 'idle'}
      <button class="send stop" onclick={() => chat.stop(id)} aria-label="停止"><span></span></button>
    {:else}
      <button class="send" onclick={send} disabled={!draft.trim()} aria-label="发送"><Glyph paths={['M12 19V5', 'm5 12 7-7 7 7']} size={20} color="#fff" width={2.6} /></button>
    {/if}
  </div>
  {#if panel && actions.length}
    <div class="panel">
      {#each actions as a (a.pluginId + '/' + a.id)}
        <button class="act" onclick={() => { active = a; }}>
          <Icon spec={a.icon} size={54} radius="14px" shadow={false} />
          <span>{a.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<Sheet open={!!active} onclose={() => (active = null)} title={active?.label}>
  {#if active && conv.value && character.value}
    {@const Comp = active.component}
    {@const a = active}
    <Comp conversationId={id} campaignId={conv.value.campaignId} characterId={character.value.id} onsend={(m: OutgoingMessage) => sendOutgoing(a, m)} onclose={() => (active = null)} />
  {/if}
</Sheet>

<Sheet bind:open={menu} title={character.value?.name}>
  <List>
    <Cell title="重新生成最后一条" onclick={() => { menu = false; chat.regenerate(id); }} />
    <Cell title="推进时间…" subtitle="跳到明早、三天后，角色会接着那个时间点说话" onclick={() => { menu = false; openTimeSheet(); }} />
    <Cell title="他的主页" subtitle="状态、钱包、朋友圈、他记得什么" onclick={() => { menu = false; openProfile(); }} />
    <Cell title="编辑角色卡" onclick={() => { menu = false; if (character.value) nav.push('characters', 'detail', { id: character.value.id }); }} />
    <Cell title="清空对话" onclick={clearAll} />
  </List>
</Sheet>
<Sheet bind:open={timeSheet} title="推进时间">
  <div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); advance(); } }} role="presentation">
  <div class="quick">
    {#each quick as q (q.label)}<button onclick={() => advance(q.ts)}>{q.label}</button>{/each}
    {#if nextEvent}<button onclick={() => advance(nextEvent!.start)}>到「{nextEvent.title}」{clock.formatShort(nextEvent.start, character.value?.timeZone)}</button>{/if}
  </div>
  <List footer={`这局现在是 ${clock.format(storyNow(), character.value?.timeZone)}。推进后会先整理记忆，他把这段时间过完，再插一条旁白；他不会马上开口，你下一条消息发出去他才接着那个时间点说话。想让他定住不走，去他的主页把这局停表。`}>
    <Field label="来到" type="datetime-local" bind:value={timeWhen} />
    <Field multiline rows={2} bind:value={timeNote} placeholder="这段时间发生了什么，可选" />
  </List>
  <div class="actions"><Button onclick={() => advance()}>推进</Button></div>
  </div>
</Sheet>
<Sheet open={!!picked} onclose={() => (picked = null)} title="这条消息">
  <List>
    <Cell title="复制" onclick={copyPicked} />
    {#if picked && textOf(picked).trim()}<Cell title="引用" onclick={quotePicked} />{/if}
    <Cell title="删除" onclick={deletePicked} />
    <Cell title="取消" onclick={() => (picked = null)} />
  </List>
</Sheet>

<style>
  .conv { display: flex; flex-direction: column; height: 100%; }
  .quick { display: flex; gap: 8px; margin: 0 16px 12px; overflow-x: auto; }
  .quick button { flex: 0 0 auto; padding: 7px 14px; border-radius: 999px; background: var(--fill-2); color: var(--label); font-size: 14px; }
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
  .avatar-btn { display: inline-flex; flex: 0 0 auto; padding: 0; }
  .caption { font-size: 11px; color: var(--label-3); padding-left: 6px; }
  .quote { font-size: 13px; line-height: 1.35; color: var(--label-2); background: var(--fill-2); border-radius: 8px; padding: 5px 9px; max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
  .user .quote { align-self: flex-end; }
  .quoting { display: flex; align-items: center; gap: 8px; padding: 6px 14px 0; background: var(--bg-grouped); }
  .qtext { flex: 1; min-width: 0; font-size: 13px; color: var(--label-2); background: var(--fill-2); border-radius: 8px; padding: 6px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qclose { color: var(--label-2); font-size: 14px; padding: 4px 6px; }
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
  .plus { width: 34px; height: 34px; border-radius: 17px; display: grid; place-items: center; flex: 0 0 auto; margin-bottom: 1px; transition: transform 0.2s; }
  .plus.open { transform: rotate(45deg); }
  .panel { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 8px; padding: 14px 16px calc(var(--safe-bottom) + 14px); background: var(--bg-grouped); border-top: 0.5px solid var(--separator); }
  .act { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12px; color: var(--label-2); }

  /* 微信样式：灰底、绿白气泡、两边头像、方一点的角 */
  .conv.wechat { --wx-bg: #ededed; --wx-bar: #f7f7f7; }
  :global([data-theme="dark"]) .conv.wechat, :global(.dark-system:not([data-theme="light"])) .conv.wechat { --wx-bg: #111111; --wx-bar: #1e1e1e; }
  .conv.wechat :global(.nav), .conv.wechat .status { background: var(--wx-bar); }
  .conv.wechat .msgs { background: var(--wx-bg); gap: 10px; }
  .conv.wechat .msg { max-width: 85%; align-items: flex-start; gap: 8px; }
  .conv.wechat .bubble { border-radius: 6px; font-size: 16px; padding: 9px 12px; }
  .conv.wechat .assistant .bubble { background: #ffffff; color: #111; }
  .conv.wechat .user .bubble { background: #95ec69; color: #111; }
  :global([data-theme="dark"]) .conv.wechat .assistant .bubble, :global(.dark-system:not([data-theme="light"])) .conv.wechat .assistant .bubble { background: #2c2c2c; color: #eee; }
  :global([data-theme="dark"]) .conv.wechat .user .bubble, :global(.dark-system:not([data-theme="light"])) .conv.wechat .user .bubble { background: #3eb575; color: #fff; }
  .conv.wechat .composer, .conv.wechat .panel, .conv.wechat .quoting { background: var(--wx-bar); }
  .conv.wechat textarea { border-radius: 6px; border: 0; }
  .conv.wechat .send { border-radius: 6px; background: #07c160; }
  .conv.wechat .time, .conv.wechat .sys { color: var(--label-2); }
</style>

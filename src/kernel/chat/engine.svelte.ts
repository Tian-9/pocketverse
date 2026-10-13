import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { Message } from '../storage/db';
import { loadState, retractSource, stateLines } from '../memory/state';
import { render } from '../llm/gate.svelte';
import { buildReport } from '../context/report';
import type { AssembleInput } from '../context/assemble';
import { repo } from '../data/repo';
import { loreApplies } from '../data/lore';
import { assemble } from '../context/assemble';
import { kernelTools, shareTool, attachedTool, attachedPrompt, toolLabel } from '../context/tools';
import { catchup, elapsedText } from '../catchup/catchup';
import { wakes, wakeNotice } from '../catchup/wake';
import type { ToolContext } from '../context/tools';
import { memoryNotes } from '../context/memfs';
import { clock } from '../context/clock';
import { runToolLoop, type LoopTool } from './loop';
import { extractTags } from './tags';
import { llm } from '../llm/gateway.svelte';
import { LlmError } from '../llm/types';
import { bus } from '../bus/bus';
import { registry } from '../registry/registry.svelte';
import { consolidate } from '../memory/consolidate';
import type { PromptContext, MessageCard, PluginManifest, ShareCard } from '../api/types';
import { log } from '../log/log';

export type TurnStatus = 'idle' | 'thinking' | 'typing' | 'tool';

interface Live { conversationId: string; status: TurnStatus; statusText: string; text: string; abort: AbortController }

/** 聊天引擎：一轮 = 存用户消息 → 拼装 → 工具循环 → 存回复 → 记账 → 视情况合并记忆。 */
class ChatEngine {
  live = $state<Record<string, Live>>({});
  userName = $state('我');
  userProfile = $state('');
  rules = $state('');

  async boot() {
    this.userName = await db().getKV('kernel.userName', '我');
    this.userProfile = await db().getKV('kernel.userProfile', '');
    this.rules = await db().getKV('kernel.rules', '');
  }
  async setUserName(n: string) { this.userName = n.trim() || '我'; await db().setKV('kernel.userName', this.userName); }
  async setUserProfile(p: string) { this.userProfile = p; await db().setKV('kernel.userProfile', p); }
  async setRules(r: string) { this.rules = r; await db().setKV('kernel.rules', r); }

  statusOf(conversationId: string): TurnStatus { return this.live[conversationId]?.status ?? 'idle'; }

  async send(conversationId: string, text: string, extra: Partial<Message> = {}) {
    if (this.live[conversationId]) return;
    await repo.addMessage(conversationId, 'user', text, extra);
    // 他定的"没回就追一句"：你回了就作废
    const conv = await db().conversations.get(conversationId);
    if (conv) { const w = await wakes.get(conv.campaignId); if (w?.onlyIfSilent) await wakes.clear(conv.campaignId); }
    await this.runTurn(conversationId);
  }

  async regenerate(conversationId: string) {
    if (this.live[conversationId]) return;
    const msgs = await repo.messagesOf(conversationId);
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') await this.forget(last);
    await this.runTurn(conversationId);
  }

  stop(conversationId: string) { this.live[conversationId]?.abort.abort(); }
  async deleteMessage(id: string) { const m = await db().messages.get(id); if (m) await this.forget(m); }

  /** 删一条消息，连它带来的状态一起撤回：整理挂在消息 id 上，聊天里 state_update 挂在这一轮的 meta.turn 上 */
  private async forget(m: Message) {
    await db().messages.delete(m.id);
    const conv = await db().conversations.get(m.conversationId);
    if (!conv) return;
    await retractSource(conv.campaignId, m.id);
    const turn = m.meta?.turn;
    if (typeof turn === 'string') await retractSource(conv.campaignId, turn);
  }
  async editMessage(id: string, text: string) { await db().messages.update(id, { content: [{ type: 'text', text }] }); }

  /**
   * 推进剧情时间到 toTs（剧情时刻）：整理记忆，拨时钟，他把这段时间过完（补发），写一条旁白。
   * 不让他马上开口：旁白存成用户侧的一条，你下一条消息发出去时和它合成一轮一起给模型（拼装时连着的用户消息会并成一条）。
   */
  async advanceTime(conversationId: string, toTs: number, note?: string) {
    if (this.live[conversationId]) return;
    const conv = await db().conversations.get(conversationId);
    const campaign = conv && (await db().campaigns.get(conv.campaignId));
    const character = conv && (await repo.characterOfConversation(conv));
    if (!conv || !campaign) return;
    // 推进时间是章节分隔：先把之前的事整理成记忆，之后的上下文只带分隔点附近几条原话
    this.live[conversationId] = { conversationId, status: 'thinking', statusText: '正在整理之前的事…', text: '', abort: new AbortController() };
    try { await consolidate(conversationId, { force: true, reason: '推进时间' }); }
    catch { /* 已记日志，整理失败不挡推进 */ }
    finally { delete this.live[conversationId]; }
    const fromTs = clock.now(campaign.clock);
    await repo.setClock(campaign.id, clock.skipTo(campaign.clock, toTs));
    // 他也过了这段时间：跳三天就按 days 档补一次（朋友圈、日记、回评论），再接着聊
    if (toTs > fromTs) {
      this.live[conversationId] = { conversationId, status: 'thinking', statusText: '这段时间他过得怎么样…', text: '', abort: new AbortController() };
      try { await catchup.skipped(campaign.id, fromTs, toTs); }
      catch { /* 已记日志 */ }
      finally { delete this.live[conversationId]; }
    }
    // 跳过的时间是两个人各自照常过的，不是「对方消失了」：同学照常上课碰面，没特别的事
    const passed = toTs - fromTs >= 3600_000 ? `这${elapsedText(toTs - fromTs)}你们各自照常过，按你们的关系该见面就见了面，${note ? '除了上面说的' : ''}没发生特别的事，别当成一直没见到对方。` : '';
    await repo.addMessage(conversationId, 'user', `（时间来到：${clock.format(toTs, character?.timeZone)}${note ? '。' + note : ''}。${passed}之前聊的事都过去了，别接着之前的话茬，按现在的时间和情况说。）`, { meta: { narration: true, chapter: true }, storyTs: toTs });
  }

  /** 手动触发一次合并（设置或角色页用） */
  async consolidateNow(conversationId: string) { return consolidate(conversationId, { force: true, reason: '手动' }); }

  /**
   * 一轮要用的全部材料：读库、插件贡献、工具表、拼装。真实发送（runTurn）和「导出这一局的上下文」共用这一个函数，
   * 导出看到的就是下一轮实际会发的。dryRun：不收集「顺手处理的事」（那一步要跑插件的 collect），其余完全一样。
   */
  async prepare(conversationId: string, opts: { dryRun?: boolean } = {}) {
    const conv = await db().conversations.get(conversationId);
    const character = conv && (await repo.characterOfConversation(conv));
    const campaign = conv && (await db().campaigns.get(conv.campaignId));
    const world = campaign && (await db().worlds.get(campaign.worldId));
    if (!conv || !character || !campaign || !world) throw new Error('会话、角色或世界不存在');

    const [history, lore, overlays, memories, notes, lines] = await Promise.all([
      repo.messagesOf(conversationId),
      db().lore.filter((e) => loreApplies(e, world.id, [character.id])).toArray(),
      db().overlays.where('campaignId').equals(campaign.id).toArray(),
      db().memories.where('campaignId').equals(campaign.id).filter((m) => m.importance === 3).reverse().sortBy('createdAt'),
      memoryNotes(campaign.id),
      stateLines(campaign.id),
    ]);
    const turnId = ulid();

    const storyNow = clock.now(campaign.clock);
    const pctx: PromptContext = { campaignId: campaign.id, conversationId, characterIds: [character.id], now: storyNow };
    const plugins = registry.plugins.filter((p) => registry.isEnabled(p.id));
    const pluginStable: string[] = [], pluginVolatile: string[] = [];
    /** 每段插件贡献是谁给的，导出排查用 */
    const contributions: { source: string; kind: 'stable' | 'volatile'; text: string }[] = [];
    for (const p of plugins) for (const c of p.promptContributors ?? []) {
      try {
        if (c.stable) { const t = await c.stable(pctx); pluginStable.push(t); contributions.push({ source: `${p.id}/${c.id}`, kind: 'stable', text: t }); }
        if (c.volatile) { const t = await c.volatile(pctx); pluginVolatile.push(t); contributions.push({ source: `${p.id}/${c.id}`, kind: 'volatile', text: t }); }
      } catch (e) { console.warn(`[prompt] ${p.id}/${c.id}`, e); contributions.push({ source: `${p.id}/${c.id}`, kind: 'volatile', text: `（出错，没进上下文：${e instanceof Error ? e.message : String(e)}）` }); }
    }

    const useTools = llm.settings.tools !== false;
    // 他给自己定过"稍后联系"：告诉他一声，免得每轮重新定
    const pendingWake = useTools ? await wakes.get(campaign.id) : null;
    if (pendingWake) { const t = wakeNotice(pendingWake); pluginVolatile.push(t); contributions.push({ source: 'kernel/wake', kind: 'volatile', text: t }); }
    // 依附的事（如回朋友圈评论）挂在这一轮上：材料进最后一条用户消息，用 handle_attached 提交
    const attached = useTools && catchup.hasAttach() && !opts.dryRun ? await catchup.collectAttached(campaign, character) : [];
    if (attached.length) { const t = attachedPrompt(attached); pluginVolatile.push(t); contributions.push({ source: 'kernel/attached', kind: 'volatile', text: t }); }
    const tctx: ToolContext = { campaign, characters: [character], lore, overlays, cards: [], attached, events: [], turnId };
    const share = shareTool(plugins.flatMap((p) => p.shares ?? []));
    const hasWeb = useTools && !!llm.settings.web;
    const pluginCards: MessageCard[] = [];
    const tools: LoopTool[] = useTools ? [
      ...[...kernelTools, ...(share ? [share] : []), ...(catchup.hasAttach() ? [attachedTool] : [])].map((t) => ({ spec: t.spec, run: (input: unknown) => t.handler(input, tctx) })),
      ...plugins.flatMap((p) => (p.tools ?? []).map((t) => ({
        spec: { name: t.name, description: t.description, inputSchema: t.inputSchema },
        run: async (input: unknown) => {
          const ctx: PromptContext = { ...pctx, addCard: (tag, body, attrs = {}, alt) => pluginCards.push({ pluginId: p.id, tag, body, attrs, ...(alt ? { alt } : {}) }) };
          const r = await t.handler(input, ctx);
          return typeof r === 'string' ? r : JSON.stringify(r ?? null);
        },
      }))),
    ] : [];

    const input: AssembleInput = {
      world, campaign, characters: [character], userName: this.userName, userProfile: this.userProfile,
      lore, overlays, highlights: memories.slice(0, 10).reverse(), memoryNotes: notes, stateLines: lines, history,
      pluginStable, pluginVolatile, hasTools: tools.length > 0, hasShare: !!share && useTools, hasAttach: useTools && catchup.hasAttach(), hasWeb, rules: this.rules,
      now: new Date(storyNow), story: !clock.aligned(campaign.clock),
    };
    const assembled = assemble(input);
    return { conv, character, campaign, world, plugins, pctx, tctx, tools, share, pluginCards, turnId, useTools, hasWeb, input, assembled, contributions, dryRun: !!opts.dryRun };
  }

  /** 角色卡页「导出这一局的上下文」：下一轮实际会发的请求 + 每样设定进了哪里、没进的原因 + 原始设定 */
  async contextReport(characterId: string): Promise<{ filename: string; text: string }> {
    const ch = await db().characters.get(characterId);
    if (!ch) throw new Error('角色不存在');
    const conv = await repo.directConversation(ch);
    const t = await this.prepare(conv.id, { dryRun: true });
    const [allLore, worlds, allMemories, memfs, stateEvents] = await Promise.all([
      db().lore.toArray(), db().worlds.toArray(),
      db().memories.where('campaignId').equals(t.campaign.id).reverse().sortBy('createdAt'),
      db().memfs.where('campaignId').equals(t.campaign.id).toArray(),
      loadState(t.campaign.id),
    ]);
    const role = 'chat' as const;
    const model = llm.modelFor(role), effort = llm.effortFor(role);
    const request = render({
      model, effort, purpose: 'chat', maxTokens: llm.cap(model, undefined, effort), role,
      system: t.assembled.system, messages: t.assembled.messages, tools: t.tools.map((x) => x.spec), web: t.hasWeb,
      names: { user: this.userName, assistant: t.character.name },
    });
    const text = buildReport({
      character: t.character, campaign: t.campaign, world: t.world, worlds, allLore, overlays: t.input.overlays,
      memories: allMemories, memfs, stateEvents, input: t.input, assembled: t.assembled,
      toolNames: t.tools.map((x) => x.spec.name), useTools: t.useTools, contributions: t.contributions, request,
      settings: { model, effort, tools: t.useTools, web: t.hasWeb, preview: !!llm.settings.preview },
    });
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    // 文件名只用 ASCII：有的浏览器遇到中文文件名会退回成 download；角色名在文件标题里
    return { filename: `pocketverse-context-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`, text };
  }

  private async runTurn(conversationId: string) {
    const { character, campaign, plugins, pctx, tctx, tools, pluginCards, turnId, assembled: { system, messages, l1Hits } } = await this.prepare(conversationId);

    const abort = new AbortController();
    this.live[conversationId] = { conversationId, status: 'thinking', statusText: '正在思考…', text: '', abort };
    bus.emit('llm.turn.start', { conversationId });
    const setStatus = (s: string) => {
      const l = this.live[conversationId]; if (!l) return;
      if (s === 'typing') { l.status = 'typing'; l.statusText = '正在输入…'; }
      else if (s.startsWith('tool:')) { l.status = 'tool'; l.statusText = `正在${toolLabel(s.slice(5))}…`; }
      else { l.status = 'thinking'; l.statusText = '正在思考…'; }
    };
    try {
      const { result: r, toolsUsed, thinking } = await runToolLoop(
        (req, hooks) => llm.chat(req, hooks),
        { system, messages, purpose: 'chat', conversationId, names: { user: this.userName, assistant: character.name } },
        tools,
        { hooks: { signal: abort.signal, onStatus: setStatus, onText: (d) => { const l = this.live[conversationId]; if (l) { l.text += d; } } }, onToolUsed: (name) => { log.info('chat', `调用工具 ${name}`, { conversationId }); const l = this.live[conversationId]; if (l) l.text = ''; } },
      );
      // 插件注册的输出标签：抽出来交给插件处理，卡片记在 meta 里由聊天界面渲染
      const handlers = plugins.flatMap((p) => (p.outputHandlers ?? []).map((h) => ({ pluginId: p.id, h })));
      const { text, found } = extractTags(r.text.trim(), handlers.map((x) => x.h.tag));
      // 工具产生的分享卡在前（它们先发生），标签卡在后
      const cards: MessageCard[] = [
        ...tctx.cards.map((c) => ({ pluginId: 'kernel', tag: 'share', body: JSON.stringify(c), attrs: {}, alt: shareAlt(c, plugins) })),
        ...pluginCards,
      ];
      for (const f of found) {
        const owner = handlers.find((x) => x.h.tag === f.tag);
        if (!owner) continue;
        try { await owner.h.onParsed?.(f.body, f.attrs, pctx); } catch (e) { console.warn(`[output] ${owner.pluginId}/${f.tag}`, e); }
        cards.push({ pluginId: owner.pluginId, tag: f.tag, body: f.body, attrs: f.attrs });
      }
      // turn：这一轮工具写的状态事件挂在它上面，删这条回复就一起撤回
      const meta: Record<string, unknown> = { turn: turnId };
      if (toolsUsed.length) meta.tools = toolsUsed;
      if (l1Hits.length) meta.lore = l1Hits;
      if (cards.length) meta.cards = cards;
      if (thinking) meta.thinking = thinking;
      // 工具产生的事件旁白（他拍了拍你）：发生在回复之前，先写
      for (const ev of tctx.events) await repo.addMessage(conversationId, 'assistant', ev.text, { meta: { narration: true, modelText: ev.modelText } });
      if (r.refusal) {
        await repo.addMessage(conversationId, 'system', `（这条回复被安全策略拦下了${r.refusal.category ? '：' + r.refusal.category : ''}）`);
      } else if (text || cards.length) {
        const parts = splitReply(text);
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) {
            // 后面的气泡慢慢冒出来，像在连发
            const l = this.live[conversationId]; if (l) { l.text = ''; l.status = 'typing'; l.statusText = '正在输入…'; }
            await sleep(Math.min(300 + parts[i]!.length * 35, 1500), abort.signal);
            if (abort.signal.aborted) break;
          }
          // 卡片挂在第一条（先分享再评论），其余 meta（工具、思考）挂在最后一条
          const isFirst = i === 0, isLast = i === parts.length - 1;
          const { cards: metaCards, ...rest } = meta;
          const mine: Record<string, unknown> = { turn: turnId, ...(isFirst && metaCards ? { cards: metaCards } : {}), ...(isLast ? rest : {}) };
          await repo.addMessage(conversationId, 'assistant', parts[i]!, { meta: mine });
        }
        if (!parts.length && cards.length) await repo.addMessage(conversationId, 'assistant', '', { meta });
      }
      bus.emit('llm.turn.end', { conversationId, usage: r.usage, model: r.model });
      if (tctx.attached.length) log.warn('chat', `模型没处理顺手的事：${tctx.attached.map((t) => t.item.label).join('、')}，下一轮再给他`, { conversationId });
      log.info('chat', `回复完成：${toolsUsed.length} 次工具，${cards.length} 张卡片`, { conversationId, model: r.model, stopReason: r.stopReason });
      consolidate(conversationId, { reason: '回复后检查' }).catch(() => { /* 已记日志 */ });
    } catch (e) {
      const partial = this.live[conversationId]?.text.trim();
      if (e instanceof LlmError && e.kind === 'aborted') {
        if (partial) await repo.addMessage(conversationId, 'assistant', partial);
        else if (e.message.includes('取消')) await repo.addMessage(conversationId, 'system', '（你在预览里取消了发送，这条没有发出去）');
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await repo.addMessage(conversationId, 'system', `（出错了：${msg}）`);
        bus.emit('llm.turn.error', { conversationId, message: msg });
      }
    } finally {
      delete this.live[conversationId];
    }
  }
}

/** 分享卡的文字版，如「[分享了歌：晴天 - 周杰伦]」；标签来自解析器的 label */
export function shareAlt(card: ShareCard, plugins: PluginManifest[]): string {
  const label = plugins.flatMap((p) => p.shares ?? []).find((r) => r.type === card.type)?.label ?? '';
  return `[分享了${label}：${card.title}${card.subtitle ? ' - ' + card.subtitle : ''}]`;
}

/** 把一次回复按行拆成多条消息；空行丢掉，最多 6 条，超过的并进最后一条 */
export function splitReply(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.replace(/^\s*[-•\d]+[.、)]\s*/, '').trim()).filter(Boolean);
  if (lines.length <= 6) return lines;
  return [...lines.slice(0, 5), lines.slice(5).join('\n')];
}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
}

export const chat = new ChatEngine();
export type { Message };

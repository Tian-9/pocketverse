import { db } from '../storage/db';
import type { Message } from '../storage/db';
import { repo } from '../data/repo';
import { assemble } from '../context/assemble';
import { kernelTools, shareTool, attachedTool, attachedPrompt, toolLabel } from '../context/tools';
import { catchup } from '../catchup/catchup';
import type { ToolContext } from '../context/tools';
import { memoryIndex } from '../context/memfs';
import { runToolLoop, type LoopTool } from './loop';
import { extractTags } from './tags';
import { llm } from '../llm/gateway.svelte';
import { LlmError } from '../llm/types';
import { bus } from '../bus/bus';
import { registry } from '../registry/registry.svelte';
import { consolidate } from '../memory/consolidate';
import type { PromptContext } from '../api/types';
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
    bus.on('app.closed', () => this.consolidateAll());
  }
  async setUserName(n: string) { this.userName = n.trim() || '我'; await db().setKV('kernel.userName', this.userName); }
  async setUserProfile(p: string) { this.userProfile = p; await db().setKV('kernel.userProfile', p); }
  async setRules(r: string) { this.rules = r; await db().setKV('kernel.rules', r); }

  statusOf(conversationId: string): TurnStatus { return this.live[conversationId]?.status ?? 'idle'; }

  async send(conversationId: string, text: string, extra: Partial<Message> = {}) {
    if (this.live[conversationId]) return;
    await repo.addMessage(conversationId, 'user', text, { ...(await this.stamp(conversationId)), ...extra });
    await this.runTurn(conversationId);
  }

  /** 剧情时间模式下，消息带上当时的剧情时间，聊天界面按它显示分隔线 */
  private async stamp(conversationId: string): Promise<Partial<Message>> {
    const conv = await db().conversations.get(conversationId);
    const ch = conv && (await repo.characterOfConversation(conv));
    const cp = conv && (await db().campaigns.get(conv.campaignId));
    if (ch?.timeMode === 'story' && cp?.state.inWorldTime) return { inWorldTs: cp.state.inWorldTime };
    return {};
  }

  async regenerate(conversationId: string) {
    if (this.live[conversationId]) return;
    const msgs = await repo.messagesOf(conversationId);
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') await db().messages.delete(last.id);
    await this.runTurn(conversationId);
  }

  stop(conversationId: string) { this.live[conversationId]?.abort.abort(); }
  async deleteMessage(id: string) { await db().messages.delete(id); }
  async editMessage(id: string, text: string) { await db().messages.update(id, { content: [{ type: 'text', text }] }); }

  /** 推进剧情时间：写一条旁白，更新状态，然后让角色接着说 */
  async advanceTime(conversationId: string, when: string, note?: string) {
    if (this.live[conversationId]) return;
    const conv = await db().conversations.get(conversationId);
    const campaign = conv && (await db().campaigns.get(conv.campaignId));
    if (!conv || !campaign) return;
    await db().campaigns.update(campaign.id, { state: { ...campaign.state, inWorldTime: when } });
    await repo.addMessage(conversationId, 'user', `（时间来到：${when}${note ? '。' + note : ''}）`, { meta: { narration: true }, inWorldTs: when });
    await this.runTurn(conversationId);
  }

  /** 手动触发一次合并（设置或角色页用） */
  async consolidateNow(conversationId: string) { return consolidate(conversationId, { force: true }); }

  private async consolidateAll() {
    const convs = await db().conversations.toArray();
    log.info('consolidate', `回到桌面，检查 ${convs.length} 个会话`);
    for (const c of convs) consolidate(c.id).catch(() => { /* 已记日志 */ });
  }

  private async runTurn(conversationId: string) {
    const conv = await db().conversations.get(conversationId);
    const character = conv && (await repo.characterOfConversation(conv));
    const campaign = conv && (await db().campaigns.get(conv.campaignId));
    const world = campaign && (await db().worlds.get(campaign.worldId));
    if (!conv || !character || !campaign || !world) throw new Error('会话、角色或世界不存在');

    const [history, lore, overlays, memories, memIndex] = await Promise.all([
      repo.messagesOf(conversationId),
      db().lore.filter((e) => e.kind === 'style' || (e.worldId === world.id && (e.scope === 'world' || !e.characterIds?.length || e.characterIds.includes(character.id)))).toArray(),
      db().overlays.where('campaignId').equals(campaign.id).toArray(),
      db().memories.where('campaignId').equals(campaign.id).filter((m) => m.importance === 3).reverse().sortBy('createdAt'),
      memoryIndex(campaign.id),
    ]);

    const pctx: PromptContext = { campaignId: campaign.id, conversationId, characterIds: [character.id] };
    const plugins = registry.plugins.filter((p) => registry.isEnabled(p.id));
    const pluginStable: string[] = [], pluginVolatile: string[] = [];
    for (const p of plugins) for (const c of p.promptContributors ?? []) {
      try {
        if (c.stable) pluginStable.push(await c.stable(pctx));
        if (c.volatile) pluginVolatile.push(await c.volatile(pctx));
      } catch (e) { console.warn(`[prompt] ${p.id}/${c.id}`, e); }
    }

    const useTools = llm.settings.tools !== false;
    // 依附的事（如回朋友圈评论）挂在这一轮上：材料进最后一条用户消息，用 handle_attached 提交
    const attached = useTools && catchup.hasAttach() ? await catchup.collectAttached(campaign, character) : [];
    if (attached.length) pluginVolatile.push(attachedPrompt(attached));
    const tctx: ToolContext = { campaign, characters: [character], lore, overlays, cards: [], attached };
    const share = shareTool(plugins.flatMap((p) => p.shares ?? []));
    const hasWeb = useTools && !!llm.settings.web;
    const pluginCards: { pluginId: string; tag: string; body: string; attrs: Record<string, string> }[] = [];
    const tools: LoopTool[] = useTools ? [
      ...[...kernelTools, ...(share ? [share] : []), ...(catchup.hasAttach() ? [attachedTool] : [])].map((t) => ({ spec: t.spec, run: (input: unknown) => t.handler(input, tctx) })),
      ...plugins.flatMap((p) => (p.tools ?? []).map((t) => ({
        spec: { name: t.name, description: t.description, inputSchema: t.inputSchema },
        run: async (input: unknown) => {
          const ctx: PromptContext = { ...pctx, addCard: (tag, body, attrs = {}) => pluginCards.push({ pluginId: p.id, tag, body, attrs }) };
          const r = await t.handler(input, ctx);
          return typeof r === 'string' ? r : JSON.stringify(r ?? null);
        },
      }))),
    ] : [];

    const { system, messages, l1Hits } = assemble({
      world, campaign, characters: [character], userName: this.userName, userProfile: this.userProfile,
      lore, overlays, highlights: memories.slice(0, 10).reverse(), memoryIndex: memIndex, history,
      pluginStable, pluginVolatile, hasTools: tools.length > 0, hasShare: !!share && useTools, hasWeb, rules: this.rules, storyTime: character.timeMode === 'story',
    });

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
      const cards: { pluginId: string; tag: string; body: string; attrs: Record<string, string> }[] = [
        ...tctx.cards.map((c) => ({ pluginId: 'kernel', tag: 'share', body: JSON.stringify(c), attrs: {} })),
        ...pluginCards,
      ];
      for (const f of found) {
        const owner = handlers.find((x) => x.h.tag === f.tag);
        if (!owner) continue;
        try { await owner.h.onParsed?.(f.body, f.attrs, pctx); } catch (e) { console.warn(`[output] ${owner.pluginId}/${f.tag}`, e); }
        cards.push({ pluginId: owner.pluginId, tag: f.tag, body: f.body, attrs: f.attrs });
      }
      const meta: Record<string, unknown> = {};
      if (toolsUsed.length) meta.tools = toolsUsed;
      if (l1Hits.length) meta.lore = l1Hits;
      if (cards.length) meta.cards = cards;
      if (thinking) meta.thinking = thinking;
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
          const mine: Record<string, unknown> = { ...(isFirst && metaCards ? { cards: metaCards } : {}), ...(isLast ? rest : {}) };
          await repo.addMessage(conversationId, 'assistant', parts[i]!, { ...(await this.stamp(conversationId)), ...(Object.keys(mine).length ? { meta: mine } : {}) });
        }
        if (!parts.length && cards.length) await repo.addMessage(conversationId, 'assistant', '', { meta });
      }
      bus.emit('llm.turn.end', { conversationId, usage: r.usage, model: r.model });
      log.info('chat', `回复完成：${toolsUsed.length} 次工具，${cards.length} 张卡片`, { conversationId, model: r.model, stopReason: r.stopReason });
      consolidate(conversationId).catch(() => { /* 已记日志 */ });
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

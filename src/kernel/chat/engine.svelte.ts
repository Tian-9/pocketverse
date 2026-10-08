import { db } from '../storage/db';
import type { Message } from '../storage/db';
import { repo } from '../data/repo';
import { assemble } from '../context/assemble';
import { kernelTools, toolLabel } from '../context/tools';
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

  async send(conversationId: string, text: string) {
    if (this.live[conversationId]) return;
    await repo.addMessage(conversationId, 'user', text);
    await this.runTurn(conversationId);
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

  /** 手动触发一次合并（设置或角色页用） */
  async consolidateNow(conversationId: string) { return consolidate(conversationId, { force: true }); }

  private async consolidateAll() {
    const convs = await db().conversations.toArray();
    for (const c of convs) consolidate(c.id).catch((e) => console.warn('[consolidate]', e));
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

    const tctx: ToolContext = { campaign, characters: [character], lore, overlays };
    const useTools = llm.settings.tools !== false;
    const tools: LoopTool[] = useTools ? [
      ...kernelTools.map((t) => ({ spec: t.spec, run: (input: unknown) => t.handler(input, tctx) })),
      ...plugins.flatMap((p) => (p.tools ?? []).map((t) => ({
        spec: { name: t.name, description: t.description, inputSchema: t.inputSchema },
        run: async (input: unknown) => { const r = await t.handler(input, pctx); return typeof r === 'string' ? r : JSON.stringify(r ?? null); },
      }))),
    ] : [];

    const { system, messages, l1Hits } = assemble({
      world, campaign, characters: [character], userName: this.userName, userProfile: this.userProfile,
      lore, overlays, highlights: memories.slice(0, 10).reverse(), memoryIndex: memIndex, history,
      pluginStable, pluginVolatile, hasTools: tools.length > 0, rules: this.rules,
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
      const { result: r, toolsUsed } = await runToolLoop(
        (req, hooks) => llm.chat(req, hooks),
        { system, messages, purpose: 'chat', conversationId },
        tools,
        { hooks: { signal: abort.signal, onStatus: setStatus, onText: (d) => { const l = this.live[conversationId]; if (l) { l.text += d; } } }, onToolUsed: () => { const l = this.live[conversationId]; if (l) l.text = ''; } },
      );
      // 插件注册的输出标签：抽出来交给插件处理，卡片记在 meta 里由聊天界面渲染
      const handlers = plugins.flatMap((p) => (p.outputHandlers ?? []).map((h) => ({ pluginId: p.id, h })));
      const { text, found } = extractTags(r.text.trim(), handlers.map((x) => x.h.tag));
      const cards: { pluginId: string; tag: string; body: string; attrs: Record<string, string> }[] = [];
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
      if (r.refusal) {
        await repo.addMessage(conversationId, 'system', `（这条回复被安全策略拦下了${r.refusal.category ? '：' + r.refusal.category : ''}）`);
      } else if (text || cards.length) {
        await repo.addMessage(conversationId, 'assistant', text, Object.keys(meta).length ? { meta } : {});
      }
      bus.emit('llm.turn.end', { conversationId, usage: r.usage, model: r.model });
      consolidate(conversationId).catch((e) => console.warn('[consolidate]', e));
    } catch (e) {
      const partial = this.live[conversationId]?.text.trim();
      if (e instanceof LlmError && e.kind === 'aborted') {
        if (partial) await repo.addMessage(conversationId, 'assistant', partial);
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

export const chat = new ChatEngine();
export type { Message };

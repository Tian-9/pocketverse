import { db } from '../storage/db';
import type { Message } from '../storage/db';
import { repo } from '../data/repo';
import { assemble } from '../context/assemble';
import { llm } from '../llm/gateway.svelte';
import { LlmError } from '../llm/types';
import { bus } from '../bus/bus';

export type TurnStatus = 'idle' | 'thinking' | 'typing';

interface Live { conversationId: string; status: TurnStatus; text: string; error?: string; abort: AbortController }

/** 聊天引擎：一轮 = 存用户消息 → 拼装 → 流式调用 → 存回复 → 记账。每个会话同时只允许一轮。 */
class ChatEngine {
  live = $state<Record<string, Live>>({});
  userName = $state('我');

  async boot() {
    this.userName = await db().getKV('kernel.userName', '我');
  }
  async setUserName(n: string) {
    this.userName = n.trim() || '我';
    await db().setKV('kernel.userName', this.userName);
  }

  statusOf(conversationId: string): TurnStatus {
    return this.live[conversationId]?.status ?? 'idle';
  }

  async send(conversationId: string, text: string) {
    if (this.live[conversationId]) return;
    await repo.addMessage(conversationId, 'user', text);
    await this.runTurn(conversationId, { userText: undefined });
  }

  /** 删掉最后一条角色回复后重跑 */
  async regenerate(conversationId: string) {
    if (this.live[conversationId]) return;
    const msgs = await repo.messagesOf(conversationId);
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') await db().messages.delete(last.id);
    await this.runTurn(conversationId, {});
  }

  stop(conversationId: string) {
    this.live[conversationId]?.abort.abort();
  }

  async deleteMessage(id: string) {
    await db().messages.delete(id);
  }

  async editMessage(id: string, text: string) {
    await db().messages.update(id, { content: [{ type: 'text', text }] });
  }

  private async runTurn(conversationId: string, opts: { userText?: string }) {
    const conv = await db().conversations.get(conversationId);
    const character = conv && (await repo.characterOfConversation(conv));
    if (!conv || !character) throw new Error('会话或角色不存在');
    const history = await repo.messagesOf(conversationId);
    const now = new Date();
    const volatile = [`现在是 ${now.toLocaleString('zh-CN', { hour12: false })}。`];
    const { system, messages } = assemble({ character, userName: this.userName, history, userText: opts.userText, volatile });

    const abort = new AbortController();
    this.live[conversationId] = { conversationId, status: 'thinking', text: '', abort };
    bus.emit('llm.turn.start', { conversationId });
    try {
      const r = await llm.chat(
        { system, messages, purpose: 'chat', conversationId },
        {
          signal: abort.signal,
          onStatus: (s) => { const l = this.live[conversationId]; if (l) l.status = s === 'typing' ? 'typing' : 'thinking'; },
          onText: (d) => { const l = this.live[conversationId]; if (l) l.text += d; },
        },
      );
      const text = r.text.trim();
      if (r.refusal) {
        await repo.addMessage(conversationId, 'system', `（这条回复被安全策略拦下了${r.refusal.category ? '：' + r.refusal.category : ''}）`);
      } else if (text) {
        await repo.addMessage(conversationId, 'assistant', text);
      }
      bus.emit('llm.turn.end', { conversationId, usage: r.usage, model: r.model });
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

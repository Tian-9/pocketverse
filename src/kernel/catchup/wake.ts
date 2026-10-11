import { db } from '../storage/db';
import { repo } from '../data/repo';
import { bus } from '../bus/bus';
import { nav } from '../nav/nav.svelte';
import { timeLine } from '../context/time';
import type { CatchupItem, CatchupContext } from '../api/types';

/**
 * 稍后联系：角色在聊天里用 wake_later 工具给自己定的"闹钟"。
 * 一局只记一件（新的覆盖旧的），存 kv `kernel.wake.<campaignId>`。到点由补发（catchup）按现有路径跑一次：
 * 它是那次调用里的一段，和同时到档的插件的事拼在一起，一个角色还是一次调用。
 */
export interface Wake {
  campaignId: string;
  characterId: string;
  /** 剧情时刻（存档时钟）。走表的局和真实时间一样到点；停表的局你一跳过它就到点 */
  fireAt: number;
  /** 他那时想做或想说的事，一句话 */
  intent: string;
  /** 真实时间：追一句看对方有没有在这之后说话 */
  createdAt: number;
  /** 记下时的剧情时刻，没有就当和 createdAt 一样（旧数据） */
  createdStoryTs?: number;
  /** 只在对方到时候还没回消息时才联系（追一句）；对方回了就作废 */
  onlyIfSilent?: boolean;
}

const PREFIX = 'kernel.wake.';
const key = (campaignId: string) => PREFIX + campaignId;
export const MIN_MINUTES = 5, MAX_MINUTES = 7 * 24 * 60;
export const KEY = 'kernel_wake';

export const wakes = {
  get(campaignId: string) { return db().getKV<Wake | null>(key(campaignId), null); },
  async set(w: Wake) { await db().setKV(key(w.campaignId), w); },
  async clear(campaignId: string) { await db().kv.delete(key(campaignId)); },
  async all(): Promise<Wake[]> {
    return (await db().kv.where('key').startsWith(PREFIX).toArray()).map((r) => r.value as Wake);
  },
};

const fmtClock = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 聊天的易变段：告诉他已经记了一件，别每轮都重新记 */
export function wakeNotice(w: Wake): string {
  return `（你已经记下：${fmtClock(w.fireAt)} 要${w.onlyIfSilent ? '看看对方回没回，没回就' : ''}联系对方，想着「${w.intent}」。到时候会提醒你，不用再记。）`;
}

/** 对方在 wake 记下之后有没有说过话（追一句用） */
export async function userRepliedSince(w: Wake): Promise<boolean> {
  const convs = await db().conversations.where('campaignId').equals(w.campaignId).toArray();
  for (const c of convs) {
    const n = await db().messages.where('conversationId').equals(c.id).filter((m) => m.role === 'user' && m.ts > w.createdAt && !m.meta?.narration).count();
    if (n > 0) return true;
  }
  return false;
}

/** 补发里的一段：到点了，拿起手机决定发不发。now 是剧情此刻 */
export function wakeItem(w: Wake, now: number, timeZone?: string, story = false): CatchupItem {
  const ago = Math.max(1, Math.round((now - (w.createdStoryTs ?? w.createdAt)) / 60_000));
  const agoText = ago >= 60 ? `${Math.round(ago / 60)} 小时` : `${ago} 分钟`;
  return {
    label: '稍后联系',
    prompt: `${agoText}前你记下：晚点要联系对方，想着「${w.intent}」。${w.onlyIfSilent ? '对方到现在还没回你。' : ''}${timeLine(new Date(now), timeZone, undefined, story)}
现在到时间了。想说就发消息：1 到 3 条，每条一行，短、口语，像真的在手机上打字，不要解释自己为什么发。觉得已经没必要了就不发（send 填 false，messages 留空）。`,
    schema: { type: 'object', additionalProperties: false, required: ['send', 'messages'], properties: { send: { type: 'boolean', description: '发不发' }, messages: { type: 'array', items: { type: 'string' }, maxItems: 3, description: '要发的消息，一条一项，不发留空' } } },
    async apply(out: unknown, ctx: CatchupContext) {
      const o = out as { send?: boolean; messages?: unknown } | undefined;
      const msgs = (Array.isArray(o?.messages) ? o.messages : []).filter((m): m is string => typeof m === 'string').map((m) => m.trim().slice(0, 500)).filter(Boolean).slice(0, 3);
      if (!o?.send || !msgs.length) return;
      const ch = await db().characters.get(ctx.characterId);
      if (!ch) return;
      const conv = await repo.directConversation(ch);
      for (const m of msgs) await repo.addMessage(conv.id, 'assistant', m, { meta: { wake: true } });
      bus.emit('notify', { title: ch.name, body: msgs[0], pluginId: 'chat', action: () => { nav.push('chat', 'app'); nav.push('chat', 'conversation', { id: conv.id }); } });
    },
  };
}

import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext } from '$kernel/api';
import { ulid } from 'ulid';
import SendPacket from './SendPacket.svelte';
import RedPacketCard from './RedPacketCard.svelte';

/**
 * 红包：角色能给你发（工具 + 卡片），你能给他发（「+」面板）。
 * 钱包是本机的一个数字，纯玩，不接任何支付。
 */
export interface Packet {
  id: string; conversationId: string; campaignId: string;
  from: 'user' | 'char'; amount: number; note: string; createdAt: number;
  /** 被对方领取的时间 */
  openedAt?: number;
}

let ctx: PluginContext;
export const DEFAULT_WALLET = 888;
export const yuan = (n: number) => '¥' + n.toFixed(2);

export const redpacketApi = {
  packets: () => ctx.table<Packet>('packets'),
  wallet: () => ctx.settings.get<number>('wallet', DEFAULT_WALLET),
  async adjust(delta: number) {
    const w = Math.round(((await this.wallet()) + delta) * 100) / 100;
    await ctx.settings.set('wallet', w);
    ctx.emit('redpacket.wallet', { wallet: w });
    return w;
  },
  async create(p: Omit<Packet, 'id' | 'createdAt'>) {
    const packet: Packet = { ...p, id: ulid(), createdAt: Date.now() };
    await this.packets().add(packet);
    return packet;
  },
  /** 你领角色发的红包 */
  async open(id: string) {
    const p = await this.packets().get(id);
    if (!p || p.from !== 'char' || p.openedAt) return p;
    await this.packets().update(id, { openedAt: Date.now() });
    await this.adjust(p.amount);
    return { ...p, openedAt: Date.now() };
  },
};

export default definePlugin({
  id: 'redpacket',
  name: '红包',
  version: '0.1.0',
  description: '你和角色互相发红包。钱包是本机的一个数字，纯玩。',
  storage: { tables: { packets: 'id, conversationId, campaignId, createdAt' } },
  composerActions: [{ id: 'send', label: '红包', icon: { paths: icons.redpacket, background: gradients.red }, component: SendPacket }],
  tools: [{
    name: 'redpacket_send',
    label: '发红包',
    description: '给对方发一个红包，带一句留言。只在角色真的有理由发的时候用：节日、庆祝、道歉、还钱、心血来潮都行，但不要每轮都发。金额 0.01 到 520。',
    inputSchema: { type: 'object', properties: { amount: { type: 'number', minimum: 0.01, maximum: 520 }, note: { type: 'string', description: '红包上的一句话' } }, required: ['amount', 'note'] },
    async handler(input: unknown, p: PromptContext) {
      const i = input as { amount?: unknown; note?: unknown };
      const amount = Math.round(Math.min(520, Math.max(0.01, Number(i?.amount) || 0)) * 100) / 100;
      if (!amount) return '金额不对';
      const note = String(i?.note ?? '').trim().slice(0, 60) || '恭喜发财';
      const packet = await redpacketApi.create({ conversationId: p.conversationId, campaignId: p.campaignId, from: 'char', amount, note });
      p.addCard?.('redpacket', JSON.stringify({ id: packet.id }), {}, `[发了一个红包：${yuan(amount)}，留言「${note}」]`);
      return `已发出 ${yuan(amount)} 的红包，卡片在对话里，对方点开才会领。不用再描述红包。`;
    },
  }],
  outputHandlers: [{ tag: 'redpacket', component: RedPacketCard }],
  promptContributors: [{
    id: 'packets',
    async volatile(p: PromptContext) {
      const recent = (await ctx.table<Packet>('packets').where('campaignId').equals(p.campaignId).reverse().sortBy('createdAt')).slice(0, 3);
      if (!recent.length) return '';
      const lines = recent.map((x) => x.from === 'char'
        ? `- 你发的 ${yuan(x.amount)}「${x.note}」：${x.openedAt ? '对方领了' : '对方还没领'}`
        : `- 对方发的 ${yuan(x.amount)}「${x.note}」：${x.openedAt ? '你领了' : '你刚收到'}`);
      return `<最近的红包>\n${lines.join('\n')}\n</最近的红包>`;
    },
  }],
  onEvent: {
    /** 角色回完消息，就算把你发的红包领了 */
    async 'llm.turn.end'({ conversationId }) {
      const mine = await ctx.table<Packet>('packets').where('conversationId').equals(conversationId).filter((x) => x.from === 'user' && !x.openedAt).toArray();
      for (const x of mine) await ctx.table<Packet>('packets').update(x.id, { openedAt: Date.now() });
    },
  },
  setup(c) { ctx = c; },
});

import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext } from '$kernel/api';
import { ulid } from 'ulid';
import SendPacket from './SendPacket.svelte';
import RedPacketCard from './RedPacketCard.svelte';
import WalletSection from './WalletSection.svelte';

/**
 * 红包：角色能给你发（工具 + 卡片），你能给他发（「+」面板）。
 * 钱包是本机的一个数字，纯玩，不接任何支付。钱是剧情里的东西，所以按存档分：
 * 你和他在每一局里各有一个钱包，同一张卡在两个世界是两个钱包。
 */
export interface Packet {
  id: string; conversationId: string; campaignId: string;
  /** 这局里和你发红包的角色；旧数据可能没有 */
  characterId?: string;
  from: 'user' | 'char'; amount: number; note: string; createdAt: number;
  /** 被对方领取的时间 */
  openedAt?: number;
}

/** 钱包：主键 `${campaignId}:${ownerId}`，ownerId 是 'user' 或角色 id */
export interface Wallet { id: string; campaignId: string; ownerId: string; balance: number }

let ctx: PluginContext;
export const DEFAULT_WALLET = 888;
export const DEFAULT_CHAR_WALLET = 2000;
export const yuan = (n: number) => '¥' + n.toFixed(2);
const round = (n: number) => Math.round(n * 100) / 100;

export const redpacketApi = {
  packets: () => ctx.table<Packet>('packets'),
  wallets: () => ctx.table<Wallet>('wallets'),
  /** 某一局里某人的余额；第一次问到才建：你的从旧的全局钱包继承，他的给个默认值 */
  async wallet(campaignId: string, ownerId: string): Promise<number> {
    const id = `${campaignId}:${ownerId}`;
    const found = await this.wallets().get(id);
    if (found) return found.balance;
    const balance = ownerId === 'user' ? await ctx.settings.get<number>('wallet', DEFAULT_WALLET) : DEFAULT_CHAR_WALLET;
    await this.wallets().put({ id, campaignId, ownerId, balance });
    return balance;
  },
  async setBalance(campaignId: string, ownerId: string, balance: number) {
    const b = round(Math.max(0, balance));
    await this.wallets().put({ id: `${campaignId}:${ownerId}`, campaignId, ownerId, balance: b });
    ctx.emit('redpacket.wallet', { campaignId, ownerId, wallet: b });
    return b;
  },
  async adjust(campaignId: string, ownerId: string, delta: number) {
    return this.setBalance(campaignId, ownerId, (await this.wallet(campaignId, ownerId)) + delta);
  },
  async create(p: Omit<Packet, 'id' | 'createdAt'>) {
    const packet: Packet = { ...p, id: ulid(), createdAt: Date.now() };
    await this.packets().add(packet);
    return packet;
  },
  /** 你领角色发的红包：钱进你这局的钱包 */
  async open(id: string) {
    const p = await this.packets().get(id);
    if (!p || p.from !== 'char' || p.openedAt) return p;
    await this.packets().update(id, { openedAt: Date.now() });
    await this.adjust(p.campaignId, 'user', p.amount);
    return { ...p, openedAt: Date.now() };
  },
  /** 这一局里最近几个红包 */
  recent(campaignId: string, n = 3) {
    return this.packets().where('campaignId').equals(campaignId).reverse().sortBy('createdAt').then((xs) => xs.slice(0, n));
  },
};

export default definePlugin({
  id: 'redpacket',
  name: '红包',
  version: '0.1.0',
  description: '你和角色互相发红包。钱包是本机的一个数字，每一局各一个，纯玩。',
  storage: { tables: { packets: 'id, conversationId, campaignId, createdAt', wallets: 'id, campaignId, ownerId' } },
  composerActions: [{ id: 'send', label: '红包', icon: { paths: icons.redpacket, background: gradients.red }, component: SendPacket }],
  profileSections: [{ id: 'wallet', label: '钱包', component: WalletSection }],
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
      const me = p.characterIds[0]!;
      const balance = await redpacketApi.wallet(p.campaignId, me);
      if (amount > balance) return `你钱包里只有 ${yuan(balance)}，不够发 ${yuan(amount)} 的红包。少发点，或者这次别发。`;
      await redpacketApi.adjust(p.campaignId, me, -amount);
      const packet = await redpacketApi.create({ conversationId: p.conversationId, campaignId: p.campaignId, characterId: me, from: 'char', amount, note });
      p.addCard?.('redpacket', JSON.stringify({ id: packet.id }), {}, `[发了一个红包：${yuan(amount)}，留言「${note}」]`);
      return `已发出 ${yuan(amount)} 的红包，卡片在对话里，对方点开才会领。你钱包里还剩 ${yuan(balance - amount)}。不用再描述红包。`;
    },
  }],
  outputHandlers: [{ tag: 'redpacket', component: RedPacketCard }],
  promptContributors: [{
    id: 'packets',
    async volatile(p: PromptContext) {
      const recent = await redpacketApi.recent(p.campaignId);
      const balance = await redpacketApi.wallet(p.campaignId, p.characterIds[0]!);
      const lines = recent.map((x) => x.from === 'char'
        ? `- 你发的 ${yuan(x.amount)}「${x.note}」：${x.openedAt ? '对方领了' : '对方还没领'}`
        : `- 对方发的 ${yuan(x.amount)}「${x.note}」：${x.openedAt ? '你领了' : '你刚收到'}`);
      return `<钱包>\n你的余额：${yuan(balance)}${lines.length ? '\n最近的红包：\n' + lines.join('\n') : ''}\n</钱包>`;
    },
  }],
  onEvent: {
    /** 角色回完消息，就算把你发的红包领了，钱进他这局的钱包 */
    async 'llm.turn.end'({ conversationId }) {
      const mine = await ctx.table<Packet>('packets').where('conversationId').equals(conversationId).filter((x) => x.from === 'user' && !x.openedAt).toArray();
      for (const x of mine) {
        await ctx.table<Packet>('packets').update(x.id, { openedAt: Date.now() });
        if (x.characterId) await redpacketApi.adjust(x.campaignId, x.characterId, x.amount);
      }
    },
  },
  setup(c) { ctx = c; },
});

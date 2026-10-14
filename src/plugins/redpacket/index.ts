import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext } from '$kernel/api';
import { ulid } from 'ulid';
import SendPacket from './SendPacket.svelte';
import SendTransfer from './SendTransfer.svelte';
import RedPacketCard from './RedPacketCard.svelte';
import TransferCard from './TransferCard.svelte';
import WalletSection from './WalletSection.svelte';

/**
 * 红包和转账：角色能给你发（工具 + 卡片），你能给他发（「+」面板）。
 * 钱包是本机的一个数字，纯玩，不接任何支付。钱是剧情里的东西，所以按存档分：
 * 你和他在每一局里各有一个钱包，同一张卡在两个世界是两个钱包。
 *
 * 红包是送礼：金额藏着，拆了才到账。转账是付钱：金额明摆着，对方点「收款」才到账，也可以退回。
 * 两种共用一张表、一套钱包，用 kind 区分。
 */
export interface Packet {
  id: string; conversationId: string; campaignId: string;
  /** 这局里和你发红包的角色；旧数据可能没有 */
  characterId?: string;
  /** 没有就是红包 */
  kind?: 'packet' | 'transfer';
  from: 'user' | 'char'; amount: number; note: string; createdAt: number;
  /** 被对方领取 / 收款的时间 */
  openedAt?: number;
  /** 转账被退回的时间；退回后钱回到发的人钱包 */
  refundedAt?: number;
}
export const isTransfer = (p: Packet) => p.kind === 'transfer';
export const isPending = (p: Packet) => !p.openedAt && !p.refundedAt;

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
  /** 你领角色发的红包 / 收角色的转账：钱进你这局的钱包 */
  async open(id: string) {
    const p = await this.packets().get(id);
    if (!p || p.from !== 'char' || !isPending(p)) return p;
    await this.packets().update(id, { openedAt: Date.now() });
    await this.adjust(p.campaignId, 'user', p.amount);
    return { ...p, openedAt: Date.now() };
  },
  /** 退回一笔还没收的转账：钱回到发的人那边。你退他的，他退你的，都走这里 */
  async refund(id: string) {
    const p = await this.packets().get(id);
    if (!p || !isTransfer(p) || !isPending(p)) return p;
    await this.packets().update(id, { refundedAt: Date.now() });
    if (p.from === 'user') await this.adjust(p.campaignId, 'user', p.amount);
    else if (p.characterId) await this.adjust(p.campaignId, p.characterId, p.amount);
    return { ...p, refundedAt: Date.now() };
  },
  /** 这个对话里对方转给角色、还没处理的转账（给 transfer_refund 和回合结束自动收款用） */
  pendingFromUser(conversationId: string) {
    return this.packets().where('conversationId').equals(conversationId).filter((x) => x.from === 'user' && isPending(x)).toArray();
  },
  /** 这一局里最近几个红包 */
  recent(campaignId: string, n = 3) {
    return this.packets().where('campaignId').equals(campaignId).reverse().sortBy('createdAt').then((xs) => xs.slice(0, n));
  },
};

/**
 * 给别的插件用的钱包服务：`ctx.service<WalletService>('wallet')`。这个类型只在这里，不进 $kernel/api，内核继续不认识钱。
 * 调用方自己声明一个一样形状的最小接口。没有裸的 adjust：setBalance 会把负数截成 0，超支会悄悄清空钱包，所以扣钱只能走 charge。
 */
export interface WalletService {
  /** 某一局里某人（'user' 或角色 id）的余额 */
  balance(campaignId: string, ownerId: string): Promise<number>;
  /** 扣钱。不够返回 false，一分不动 */
  charge(campaignId: string, ownerId: string, amount: number, reason: string): Promise<boolean>;
  /** 进账 */
  credit(campaignId: string, ownerId: string, amount: number, reason: string): Promise<void>;
}

export const walletService: WalletService = {
  balance: (campaignId, ownerId) => redpacketApi.wallet(campaignId, ownerId),
  async charge(campaignId, ownerId, amount, _reason) {
    const n = round(amount);
    if (!(n > 0)) return false;
    if ((await redpacketApi.wallet(campaignId, ownerId)) < n) return false;
    await redpacketApi.adjust(campaignId, ownerId, -n);
    return true;
  },
  async credit(campaignId, ownerId, amount, _reason) {
    const n = round(amount);
    if (n > 0) await redpacketApi.adjust(campaignId, ownerId, n);
  },
};

export default definePlugin({
  id: 'redpacket',
  name: '钱包',
  version: '0.2.0',
  description: '你和角色互相发红包、转账。钱包是本机的一个数字，每一局各一个，纯玩。',
  storage: { tables: { packets: 'id, conversationId, campaignId, createdAt', wallets: 'id, campaignId, ownerId' } },
  composerActions: [
    { id: 'send', label: '红包', icon: { paths: icons.redpacket, background: gradients.red }, component: SendPacket },
    { id: 'transfer', label: '转账', icon: { paths: icons.transfer, background: gradients.orange }, component: SendTransfer },
  ],
  profileSections: [{ id: 'wallet', label: '钱包', component: WalletSection }],
  services: { wallet: walletService },
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
  }, {
    name: 'transfer_send',
    label: '转账',
    description: '给对方转一笔钱，金额明摆着，可以附一句备注。和红包的区别：红包是送礼、图个热闹；转账是付钱、还钱、AA、借钱这种正经给钱。对方要点「收款」才到账，也可能退回来。金额 0.01 到 50000。',
    inputSchema: { type: 'object', properties: { amount: { type: 'number', minimum: 0.01, maximum: 50000 }, note: { type: 'string', description: '转账备注，可不填' } }, required: ['amount'] },
    async handler(input: unknown, p: PromptContext) {
      const i = input as { amount?: unknown; note?: unknown };
      const amount = Math.round(Math.min(50000, Math.max(0.01, Number(i?.amount) || 0)) * 100) / 100;
      if (!amount) return '金额不对';
      const note = String(i?.note ?? '').trim().slice(0, 60);
      const me = p.characterIds[0]!;
      const balance = await redpacketApi.wallet(p.campaignId, me);
      if (amount > balance) return `你钱包里只有 ${yuan(balance)}，转不出 ${yuan(amount)}。少转点，或者这次别转。`;
      await redpacketApi.adjust(p.campaignId, me, -amount);
      const t = await redpacketApi.create({ conversationId: p.conversationId, campaignId: p.campaignId, characterId: me, kind: 'transfer', from: 'char', amount, note });
      p.addCard?.('transfer', JSON.stringify({ id: t.id }), {}, `[转账 ${yuan(amount)}${note ? '，备注「' + note + '」' : ''}]`);
      return `已转出 ${yuan(amount)}，卡片在对话里，对方点收款才到账，也可能退回。你钱包里还剩 ${yuan(balance - amount)}。不用再描述转账。`;
    },
  }, {
    name: 'transfer_refund',
    label: '退回转账',
    description: '把对方最近转给你、你还没收的那笔转账退回去。不想收他的钱（不要你的钱、这钱不该我收、太多了）就用这个；不调的话这轮回复完会自动收下。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_input: unknown, p: PromptContext) {
      const pending = (await redpacketApi.pendingFromUser(p.conversationId)).filter(isTransfer).sort((a, b) => b.createdAt - a.createdAt);
      const t = pending[0];
      if (!t) return '现在没有对方转给你、还没收的转账。';
      await redpacketApi.refund(t.id);
      return `已把 ${yuan(t.amount)} 退回给对方，卡片上会显示「已退还」。不用再描述退款这个动作本身，直接说你的话。`;
    },
  }],
  outputHandlers: [{ tag: 'redpacket', component: RedPacketCard }, { tag: 'transfer', component: TransferCard }],
  promptContributors: [{
    id: 'packets',
    // 余额和最近的红包转账变得少：变了才追加进历史，不每轮全价重发
    async append(p: PromptContext) {
      const recent = await redpacketApi.recent(p.campaignId);
      const balance = await redpacketApi.wallet(p.campaignId, p.characterIds[0]!);
      const lines = recent.map((x) => {
        const what = `${yuan(x.amount)}${x.note ? '「' + x.note + '」' : ''}`;
        if (isTransfer(x)) {
          if (x.from === 'char') return `- 你转的 ${what}：${x.refundedAt ? '对方退回来了' : x.openedAt ? '对方收了' : '对方还没收'}`;
          return `- 对方转给你的 ${what}：${x.refundedAt ? '你退回去了' : x.openedAt ? '你收了' : '还没处理。这轮回复完会自动收下；不想收就用 transfer_refund 退回'}`;
        }
        return x.from === 'char'
          ? `- 你发的红包 ${what}：${x.openedAt ? '对方领了' : '对方还没领'}`
          : `- 对方发的红包 ${what}：${x.openedAt ? '你领了' : '你刚收到'}`;
      });
      return `<钱包>\n你的余额：${yuan(balance)}${lines.length ? '\n最近的红包和转账：\n' + lines.join('\n') : ''}\n</钱包>`;
    },
  }],
  onEvent: {
    /** 角色回完消息，就算把你发的红包领了、转账收了，钱进他这局的钱包。回复中途用 transfer_refund 退掉的不在这里 */
    async 'llm.turn.end'({ conversationId }) {
      const mine = await redpacketApi.pendingFromUser(conversationId);
      for (const x of mine) {
        await ctx.table<Packet>('packets').update(x.id, { openedAt: Date.now() });
        if (x.characterId) await redpacketApi.adjust(x.campaignId, x.characterId, x.amount);
      }
    },
  },
  setup(c) { ctx = c; },
});

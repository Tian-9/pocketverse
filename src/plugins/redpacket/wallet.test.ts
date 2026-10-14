import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, PromptContext } from '$kernel/api';
import plugin, { redpacketApi, isPending, DEFAULT_WALLET, DEFAULT_CHAR_WALLET } from './index';

const campaignId = 'cp1', conversationId = 'cv1', me = 'c1';
const pc = (addCard?: PromptContext['addCard']): PromptContext => ({ campaignId, conversationId, characterIds: [me], addCard } as unknown as PromptContext);
const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;

beforeAll(() => {
  openDB([plugin]);
  const ctx = {
    id: 'redpacket',
    table: (n: string) => db().table(pluginTable('redpacket', n)),
    settings: { get: async <T,>(_k: string, d: T) => d, set: async () => {} },
    emit() {},
  } as unknown as PluginContext;
  plugin.setup!(ctx);
});

describe('transfers share the wallet with red packets', () => {
  it('character transfers: user can receive or refund, money moves accordingly', async () => {
    const cards: string[] = [];
    const r = await tool('transfer_send').handler({ amount: 100, note: '饭钱' }, pc((tag, _body, _attrs, alt) => cards.push(tag + ' ' + alt)));
    expect(r).toContain('已转出 ¥100.00');
    expect(cards).toEqual(['transfer [转账 ¥100.00，备注「饭钱」]']);
    expect(await redpacketApi.wallet(campaignId, me)).toBe(DEFAULT_CHAR_WALLET - 100);
    const t = (await redpacketApi.recent(campaignId, 1))[0]!;
    expect(t.kind).toBe('transfer'); expect(isPending(t)).toBe(true);
    await redpacketApi.open(t.id);
    expect(await redpacketApi.wallet(campaignId, 'user')).toBe(DEFAULT_WALLET + 100);
    // 第二笔：退还，钱回他那边
    await tool('transfer_send').handler({ amount: 20 }, pc());
    const t2 = (await redpacketApi.recent(campaignId, 1))[0]!;
    expect(await redpacketApi.wallet(campaignId, me)).toBe(DEFAULT_CHAR_WALLET - 120);
    await redpacketApi.refund(t2.id);
    expect(await redpacketApi.wallet(campaignId, me)).toBe(DEFAULT_CHAR_WALLET - 100);
    expect(await redpacketApi.wallet(campaignId, 'user')).toBe(DEFAULT_WALLET + 100);
    // 已退的不能再收
    await redpacketApi.open(t2.id);
    expect(await redpacketApi.wallet(campaignId, 'user')).toBe(DEFAULT_WALLET + 100);
  });

  it('user transfers: auto-accepted at turn end unless the character refunded it during the turn', async () => {
    const userBefore = await redpacketApi.wallet(campaignId, 'user');
    const charBefore = await redpacketApi.wallet(campaignId, me);
    // 用户转两笔（「+」面板的做法：先建记录再扣款）
    const a = await redpacketApi.create({ conversationId, campaignId, characterId: me, kind: 'transfer', from: 'user', amount: 50, note: '' });
    await redpacketApi.adjust(campaignId, 'user', -50);
    // 两笔落在同一毫秒时分不出「最近那笔」，隔开一点
    await new Promise((r) => setTimeout(r, 2));
    const b = await redpacketApi.create({ conversationId, campaignId, characterId: me, kind: 'transfer', from: 'user', amount: 30, note: '' });
    await redpacketApi.adjust(campaignId, 'user', -30);
    expect((await redpacketApi.pendingFromUser(conversationId)).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    // 角色回复中途退掉最近那笔
    expect(await tool('transfer_refund').handler({}, pc())).toContain('¥30.00');
    expect(await redpacketApi.wallet(campaignId, 'user')).toBe(userBefore - 50);
    // 回合结束：剩下那笔自动收下
    await plugin.onEvent!['llm.turn.end']!({ conversationId } as never);
    expect(await redpacketApi.wallet(campaignId, me)).toBe(charBefore + 50);
    expect(await redpacketApi.pendingFromUser(conversationId)).toEqual([]);
    expect(await tool('transfer_refund').handler({}, pc())).toContain('没有');
  });

  it('refuses a transfer the character cannot afford', async () => {
    const r = await tool('transfer_send').handler({ amount: 99999 }, pc());
    expect(r).toContain('转不出');
  });
});

describe('wallet service for other plugins', () => {
  it('charge refuses overspend without touching the balance; credit adds', async () => {
    const { walletService } = await import('./index');
    const cp = 'cp-svc';
    expect(await walletService.balance(cp, 'user')).toBe(DEFAULT_WALLET);
    expect(await walletService.charge(cp, 'user', DEFAULT_WALLET + 1, '买东西')).toBe(false);
    expect(await walletService.balance(cp, 'user')).toBe(DEFAULT_WALLET);
    expect(await walletService.charge(cp, 'user', 88, '买东西')).toBe(true);
    expect(await walletService.balance(cp, 'user')).toBe(DEFAULT_WALLET - 88);
    expect(await walletService.charge(cp, 'user', 0, '')).toBe(false);
    expect(await walletService.charge(cp, 'user', -5, '')).toBe(false);
    await walletService.credit(cp, me, 10, '退款');
    expect(await walletService.balance(cp, me)).toBe(DEFAULT_CHAR_WALLET + 10);
    expect(plugin.services?.wallet).toBe(walletService);
  });
});

describe('ledger', () => {
  it('folds an old wallet row into an opening entry the first time it is used', async () => {
    await redpacketApi.wallets().put({ id: 'cp-old:user', campaignId: 'cp-old', ownerId: 'user', balance: 123.45 });
    expect(await redpacketApi.balances('cp-old')).toEqual({ user: 123.45 });
    expect(await redpacketApi.wallet('cp-old', 'user')).toBe(123.45);
    await redpacketApi.adjust('cp-old', 'user', -200);
    expect(await redpacketApi.wallet('cp-old', 'user')).toBe(0);
    expect(await redpacketApi.balances('cp-old')).toEqual({ user: 0 });
  });
});

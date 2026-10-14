import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable, legacyBatches } from '../storage/db';
import type { Message, EpisodicMemory } from '../storage/db';
import type { PluginContext, MessageCard } from '../api/types';
import { registry } from '../registry/registry.svelte';
import { applyPatches, stateLines } from '../memory/state';
import { lastReply, rememberTurn, removeMessages, retract } from './retract';
import redpacket, { redpacketApi, DEFAULT_WALLET, DEFAULT_CHAR_WALLET } from '../../plugins/redpacket/index';

const cp = 'cp-r', cv = 'cv-r', me = 'ch-r';
let ts = 1000;
const msg = (id: string, role: Message['role'], meta?: Record<string, unknown>): Message => ({ id, conversationId: cv, role, content: [{ type: 'text', text: id }], ts: ts++, ...(meta ? { meta } : {}) });
const put = async (...ms: Message[]) => { await db().messages.bulkAdd(ms); return ms; };
const all = () => db().messages.where('conversationId').equals(cv).sortBy('ts');

beforeAll(async () => {
  openDB([redpacket]);
  redpacket.setup!({
    id: 'redpacket',
    table: (n: string) => db().table(pluginTable('redpacket', n)),
    settings: { get: async <T,>(_k: string, d: T) => d, set: async () => {} },
    emit() {},
  } as unknown as PluginContext);
  registry.register(redpacket);
  registry.enabled = { redpacket: true };
  await db().campaigns.add({ id: cp, worldId: 'w', characterIds: [me], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } });
  await db().conversations.add({ id: cv, campaignId: cp, kind: 'direct', participantIds: [me], pluginId: 'chat' });
});

describe('retract by source', () => {
  it('regenerating takes back only his receipt; deleting your red packet takes back both sides', async () => {
    // 你从「+」面板发 50 的红包：消息 id 预先分好，红包和扣款都带它
    const p = await redpacketApi.create({ conversationId: cv, campaignId: cp, characterId: me, from: 'user', amount: 50, note: '', sourceId: 'u1' });
    await redpacketApi.adjust(cp, 'user', -50, { sourceId: 'u1', packetId: p.id });
    const card: MessageCard = { pluginId: 'redpacket', tag: 'redpacket', body: JSON.stringify({ id: p.id }), attrs: {} };
    await put(msg('u1', 'user', { cards: [card] }));
    // 他回了两个气泡，回完自动领
    await put(msg('a1', 'assistant', { turn: 't1' }), msg('a2', 'assistant', { turn: 't1' }));
    await redpacket.onEvent!['llm.turn.end']!({ conversationId: cv, turn: 't1' } as never);
    expect(await redpacketApi.wallet(cp, me)).toBe(DEFAULT_CHAR_WALLET + 50);

    // 重新生成：最后一次回复整个删掉，只撤他领的那笔，红包回到「还没领」
    const reply = lastReply(await all());
    expect(reply.map((m) => m.id)).toEqual(['a1', 'a2']);
    await removeMessages(reply);
    expect(await redpacketApi.wallet(cp, me)).toBe(DEFAULT_CHAR_WALLET);
    expect(await redpacketApi.wallet(cp, 'user')).toBe(DEFAULT_WALLET - 50);
    expect((await redpacketApi.packets().get(p.id))?.openedAt).toBeUndefined();

    // 新的一轮又领了；然后你把红包删了：两边都退回
    await put(msg('a3', 'assistant', { turn: 't2' }));
    await redpacket.onEvent!['llm.turn.end']!({ conversationId: cv, turn: 't2' } as never);
    expect(await redpacketApi.wallet(cp, me)).toBe(DEFAULT_CHAR_WALLET + 50);
    await removeMessages((await all()).filter((m) => m.id === 'u1'));
    expect(await redpacketApi.wallet(cp, me)).toBe(DEFAULT_CHAR_WALLET);
    expect(await redpacketApi.wallet(cp, 'user')).toBe(DEFAULT_WALLET);
    expect(await redpacketApi.packets().get(p.id)).toBeUndefined();
    await removeMessages(await all());
  });

  it('a turn’s effects stay until every bubble of that turn is gone', async () => {
    await applyPatches(cp, [{ entity: '猫', attr: '位置', value: '客栈B' }], { source: 't3', at: 1 });
    const [b1, b2] = await put(msg('b1', 'assistant', { turn: 't3' }), msg('b2', 'assistant', { turn: 't3' }));
    await removeMessages([b1!]);
    expect((await stateLines(cp)).join()).toContain('客栈B');
    await removeMessages([b2!]);
    expect((await stateLines(cp)).join()).not.toContain('客栈B');
  });

  it('puts the clock and mood back when the turn that changed them is retracted', async () => {
    const before = { state: { relations: {}, mood: {}, facts: [] } };
    await db().campaigns.update(cp, { state: { relations: {}, mood: { [me]: '开心' }, facts: [] }, clock: { anchorStoryTs: 5000, anchorRealTs: 0, running: false } });
    await rememberTurn(cp, 't4', before);
    await retract(cp, cv, ['t4']);
    const c = (await db().campaigns.get(cp))!;
    expect(c.state.mood).toEqual({});
    expect(c.clock).toBeUndefined();
  });

  it('deleting a consolidated message retracts its whole batch and queues it for redo', async () => {
    const [x1, x2, x3] = await put(msg('x1', 'user'), msg('x2', 'assistant'), msg('x3', 'assistant'));
    const mem: EpisodicMemory = { id: 'mx', campaignId: cp, when: '', text: '吃了烤冷面', importance: 2, sourceMessageIds: ['x1', 'x2'], createdAt: 0 };
    await db().memories.add(mem);
    await applyPatches(cp, [{ entity: '烤冷面', attr: '归属', value: '吃掉了' }], { source: 'x2', at: 1 });
    await db().campaigns.update(cp, { consolidatedUpTo: x2!.ts, batches: [{ id: 'x2', conversationId: cv, from: 0, to: x2!.ts }] });
    // 没整理过的消息：不碰批次
    await removeMessages([x3!]);
    expect(await db().memories.get('mx')).toBeDefined();
    // 删到整理过的：整批撤回，等重整
    await removeMessages([x1!]);
    expect(await db().memories.get('mx')).toBeUndefined();
    expect((await stateLines(cp)).join()).not.toContain('烤冷面');
    const c = (await db().campaigns.get(cp))!;
    expect(c.batches).toEqual([]);
    expect(c.redo).toEqual([{ conversationId: cv, from: 0, to: x2!.ts }]);
  });

  it('derives batches for old memories from their source messages', async () => {
    const m = (id: string, t: number) => ({ id, conversationId: 'v', role: 'user', content: [], ts: t }) as Message;
    const msgs = new Map([m('a', 1), m('b', 2), m('c', 3), m('d', 4)].map((x) => [x.id, x]));
    const mem = (ids: string[]) => ({ sourceMessageIds: ids }) as EpisodicMemory;
    const out = await legacyBatches([mem(['c', 'd']), mem(['a', 'b']), mem(['a', 'b']), mem([])], async (ids) => ids.map((i) => msgs.get(i)));
    expect(out).toEqual([{ id: 'b', conversationId: 'v', from: 0, to: 2 }, { id: 'd', conversationId: 'v', from: 2, to: 4 }]);
  });
});

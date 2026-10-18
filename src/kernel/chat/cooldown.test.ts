import { describe, it, expect, beforeAll, vi } from 'vitest';
import { openDB, db } from '../storage/db';
import { repo } from '../data/repo';
import { chat } from './engine.svelte';
import { llm } from '../llm/gateway.svelte';
import * as memory from '../memory/consolidate';
import type { ChatResult } from '../llm/types';
import type { EpisodicMemory } from '../storage/db';

beforeAll(() => { openDB([]); });

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const reply = (text: string): ChatResult => ({ text, model: 'm', stopReason: 'end_turn', usage, content: [{ type: 'text', text }] });

// 一轮里给模型的最后一条用户消息：召回段就在这里
const tailOf = (call: unknown[]) => JSON.stringify((call[0] as { messages: unknown[] }).messages.at(-1));

describe('recall cooldown through a real turn', () => {
  it('surfaces a memory once, keeps it out for the next turns, and brings it back after a regenerate', async () => {
    vi.spyOn(memory, 'consolidate').mockResolvedValue(undefined as never);
    const send = vi.spyOn(llm, 'chat').mockImplementation(async () => reply('嗯'));
    llm.settings.tools = false;

    const c = await repo.createCharacter({ name: '方亦楷', core: 'x', full: 'x' });
    const conv = await repo.directConversation(c);
    const mem: EpisodicMemory = { id: 'cat', campaignId: conv.campaignId, when: '', text: '方亦楷答应周末带{{user}}看小猫', importance: 2, sourceMessageIds: [], createdAt: 0, bag: { core: ['小猫'] } };
    // 再放几条不相关的，让「小猫」够稀有（idf 够高），单独就能过召回门槛
    const other = (id: string, core: string): EpisodicMemory => ({ ...mem, id, text: core, bag: { core: [core] } });
    await db().memories.bulkPut([mem, other('a', '烤冷面'), other('b', '额头'), other('d', '唱片')]);

    await chat.send(conv.id, '小猫最近怎么样');
    expect(tailOf(send.mock.calls.at(-1)!)).toContain('看小猫');
    const first = (await repo.messagesOf(conv.id)).filter((m) => m.role === 'assistant').at(-1)!;
    expect(first.meta?.surfaced).toEqual(['cat']);

    // 下一轮又说到小猫：刚带过，冷却中
    await chat.send(conv.id, '小猫还好吗');
    expect(tailOf(send.mock.calls.at(-1)!)).not.toContain('看小猫');

    // 重新生成这一轮：上一版回复删掉了，冷却还是第一轮那条记的，照样不带
    await chat.regenerate(conv.id);
    expect(tailOf(send.mock.calls.at(-1)!)).not.toContain('看小猫');

    // 把第一轮的回复也删掉：它带过的不再算，下一轮又能想起来
    await chat.deleteMessage(first.id);
    await chat.regenerate(conv.id);
    expect(tailOf(send.mock.calls.at(-1)!)).toContain('看小猫');
  });
});

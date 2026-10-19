import { describe, it, expect, beforeAll, vi } from 'vitest';
import { openDB } from '../storage/db';
import { repo } from '../data/repo';
import { chat } from './engine.svelte';
import { llm } from '../llm/gateway.svelte';
import * as memory from '../memory/consolidate';
import type { ChatResult } from '../llm/types';

beforeAll(() => { openDB([]); });

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const reply = (text: string): ChatResult => ({ text, model: 'm', stopReason: 'end_turn', usage, content: [{ type: 'text', text }] });
const tailOf = (call: unknown[]) => JSON.stringify((call[0] as { messages: unknown[] }).messages.at(-1));

describe('repeat notice through real turns', () => {
  it('shows up in the next request after two replies end the same way, and only then', async () => {
    vi.spyOn(memory, 'consolidate').mockResolvedValue(undefined as never);
    const send = vi.spyOn(llm, 'chat')
      .mockResolvedValueOnce(reply('到家没？😂\n明天下午两点焦姐店里见🫡'))
      .mockResolvedValueOnce(reply('大半夜吃宽粉？😂\n明天带你去吃🫡'))
      .mockResolvedValue(reply('睡吧'));
    llm.settings.tools = false;
    const c = await repo.createCharacter({ name: '方亦楷', core: 'x', full: 'x' });
    const conv = await repo.directConversation(c);

    await chat.send(conv.id, '冒泡');
    await chat.send(conv.id, '想吃宽粉');
    expect(tailOf(send.mock.calls.at(-1)!)).not.toContain('最近两次回复');
    await chat.send(conv.id, '好吧');
    expect(tailOf(send.mock.calls.at(-1)!)).toContain('「明天」开头');
    // 他这次换了说法（睡吧），下一轮就不再提醒
    await chat.send(conv.id, '晚安');
    expect(tailOf(send.mock.calls.at(-1)!)).not.toContain('最近两次回复');
  });
});

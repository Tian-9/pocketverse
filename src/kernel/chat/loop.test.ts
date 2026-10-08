import { describe, it, expect, vi } from 'vitest';
import { runToolLoop } from './loop';
import type { ChatResult } from '../llm/types';

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const base = { system: [{ type: 'text' as const, text: 's' }], messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'q' }] }], purpose: 'test' };

describe('runToolLoop', () => {
  it('executes tool calls, feeds results back with opaque blocks preserved, and stops on end_turn', async () => {
    const chat = vi.fn<(req: any) => Promise<ChatResult>>()
      .mockResolvedValueOnce({ text: '', model: 'm', stopReason: 'tool_use', usage, content: [
        { type: 'opaque', provider: 'claude', block: { type: 'thinking', thinking: '' } },
        { type: 'tool_use', id: 't1', name: 'lore_read', input: { id: 'x' } },
      ] })
      .mockResolvedValueOnce({ text: '答', model: 'm', stopReason: 'end_turn', usage, content: [{ type: 'text', text: '答' }] });
    const run = vi.fn(async () => '正文');
    const r = await runToolLoop(chat as any, base, [{ spec: { name: 'lore_read' }, run }]);
    expect(r.result.text).toBe('答');
    expect(r.toolsUsed).toEqual(['lore_read']);
    expect(r.rounds).toBe(2);
    const second = chat.mock.calls[1]![0];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].content[0].type).toBe('opaque');
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', toolUseId: 't1', content: '正文' });
  });

  it('reports unknown tools and thrown errors as is_error results and respects maxRounds', async () => {
    const chat = vi.fn<(req: any) => Promise<ChatResult>>(async () => ({ text: '', model: 'm', stopReason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'x', name: 'boom', input: {} }] }));
    const r = await runToolLoop(chat as any, base, [{ spec: { name: 'boom' }, run: async () => { throw new Error('炸'); } }], { maxRounds: 2 });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(r.toolsUsed).toEqual(['boom', 'boom']);
    const req = chat.mock.calls[2]![0] as any;
    expect(req.messages.at(-1).content[0]).toMatchObject({ isError: true, content: '炸' });
  });
});

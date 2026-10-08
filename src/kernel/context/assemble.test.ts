import { describe, it, expect } from 'vitest';
import { assemble } from './assemble';
import type { Character, Message } from '../storage/db';

const ch: Character = { id: 'c', worldId: 'w', name: '林晚秋', core: '图书馆管理员', full: '' };
const msg = (role: Message['role'], text: string, ts: number): Message => ({ id: String(ts), conversationId: 'x', role, content: [{ type: 'text', text }], ts });

describe('assemble', () => {
  it('puts cache breakpoint at end of system and on second-to-last message', () => {
    const r = assemble({ character: ch, userName: '我', history: [msg('assistant', '你来了', 1), msg('user', '嗯', 2), msg('assistant', '坐', 3)], userText: '好' });
    expect(r.system[r.system.length - 1]!.cache).toBe(true);
    expect(r.messages[0]!.role).toBe('user'); // 补的开场
    const prev = r.messages[r.messages.length - 2]!;
    expect(prev.content[prev.content.length - 1]!.cache).toBe(true);
    expect(r.messages[r.messages.length - 1]!.role).toBe('user');
  });

  it('keeps volatile content out of system and appends it to the last user message', () => {
    const r = assemble({ character: ch, userName: '我', history: [], userText: '嗨', volatile: ['现在是 09:00'] });
    expect(r.system.map((b) => b.text).join()).not.toContain('09:00');
    expect(r.messages[r.messages.length - 1]!.content.map((b) => b.text).join('\n')).toContain('09:00');
  });

  it('regeneration drops trailing assistant turns and merges same-role runs', () => {
    const r = assemble({ character: ch, userName: '我', history: [msg('user', 'a', 1), msg('user', 'b', 2), msg('assistant', 'c', 3)] });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.content).toHaveLength(2);
  });
});

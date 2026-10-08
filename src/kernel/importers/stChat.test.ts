import { describe, it, expect } from 'vitest';
import { parseStChat } from './stChat';

describe('parseStChat', () => {
  it('reads header metadata and messages with mixed send_date formats', () => {
    const jsonl = [
      JSON.stringify({ user_name: '我', character_name: '林晚秋', chat_metadata: { summary: '两人在图书馆认识', note_prompt: '多描写雨' } }),
      JSON.stringify({ name: '林晚秋', is_user: false, mes: '你来了。', send_date: 1700000000000 }),
      JSON.stringify({ name: '我', is_user: true, mes: '嗯。', send_date: 'not a date' }),
      JSON.stringify({ name: '林晚秋', is_user: false, mes: '坐。', send_date: 1700000002000 }),
    ].join('\n');
    const c = parseStChat(jsonl);
    expect(c.characterName).toBe('林晚秋');
    expect(c.summary).toBe('两人在图书馆认识');
    expect(c.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(c.messages[1]!.ts).toBeGreaterThan(c.messages[0]!.ts);
    expect(c.messages[2]!.ts).toBeGreaterThan(c.messages[1]!.ts);
  });
  it('rejects empty and non-chat files', () => {
    expect(() => parseStChat('')).toThrow();
    expect(() => parseStChat('{"a":1}')).toThrow('没有找到消息');
    expect(() => parseStChat('{bad')).toThrow('第 1 行');
  });
});

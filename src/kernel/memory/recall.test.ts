import { describe, it, expect } from 'vitest';
import { recallMemories, recallQuery } from './recall';
import type { EpisodicMemory, Message } from '../storage/db';

const M = (id: string, text: string, bag?: EpisodicMemory['bag']): EpisodicMemory => ({ id, campaignId: 'cp', when: '', text, importance: 2, sourceMessageIds: [], createdAt: 0, ...(bag ? { bag } : {}) });
const msg = (role: Message['role'], text: string, meta?: Record<string, unknown>): Message => ({ id: text, conversationId: 'v', role, content: [{ type: 'text', text }], ts: 0, ...(meta ? { meta } : {}) });

const mems = [
  M('cat', '方亦楷答应周末带{{user}}看小猫小姨子', { core: ['小姨子', '小猫'], related: ['周末', '猫粮'] }),
  M('noodle', '方亦楷欠{{user}}一份烤冷面加俩蛋', { core: ['烤冷面', '欠'], related: ['俩蛋'] }),
  M('bump', '{{user}}额头的包已经消了', { core: ['额头', '包'] }),
];

describe('auto recall', () => {
  it('uses everything you said since his last reply', () => {
    const h = [msg('user', '早'), msg('assistant', '早啊'), msg('user', '周末'), msg('assistant', '（拍了拍你）', { narration: true }), msg('user', '去看小姨子吗')];
    expect(recallQuery(h)).toBe('周末\n去看小姨子吗');
  });
  it('finds the memory by bag terms, skips the ones already pinned, drops weak matches', () => {
    expect(recallMemories(mems, '小姨子最近胖了没').map((m) => m.id)).toEqual(['cat']);
    expect(recallMemories(mems, '小姨子最近胖了没', new Set(['cat']))).toEqual([]);
    expect(recallMemories(mems, '今天天气不错')).toEqual([]);
    expect(recallMemories(mems, '')).toEqual([]);
  });
});

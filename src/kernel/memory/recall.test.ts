import { describe, it, expect } from 'vitest';
import { explainRecall, recallMemories, recallQuery, recentlySurfaced } from './recall';
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
  it('ignores content words that are only in the text, and single characters', () => {
    const rec = M('rec', '{{user}}说明天去唱片店买三份一样的唱片', { core: ['物理卷子'], related: ['补习'] });
    expect(recallMemories([rec], '我昨天去唱片店、珊姐说你买了三份一样唱片')).toEqual([]);
  });
  it('finds the memory by bag terms, skips the ones already pinned, drops weak matches', () => {
    expect(recallMemories(mems, '小姨子最近胖了没').map((m) => m.id)).toEqual(['cat']);
    expect(recallMemories(mems, '小姨子最近胖了没', new Set(['cat']))).toEqual([]);
    expect(recallMemories(mems, '今天天气不错')).toEqual([]);
    expect(recallMemories(mems, '')).toEqual([]);
  });

  it('cooldown: picks the top hits first, then drops cooled ones without backfilling', () => {
    const cat2 = M('cat2', '{{user}}给小姨子买了猫粮', { related: ['小姨子', '猫粮'] });
    const all = [...mems, cat2];
    expect(recallMemories(all, '小姨子要不要猫粮').map((m) => m.id)).toEqual(['cat', 'cat2']);
    // 最相关的 cat 刚提过：这轮只剩 cat2，不会把别的往上补
    expect(recallMemories(all, '小姨子要不要猫粮', new Set(), new Set(['cat'])).map((m) => m.id)).toEqual(['cat2']);
    expect(recallMemories(all, '小姨子要不要猫粮', new Set(), new Set(['cat', 'cat2']))).toEqual([]);
  });

  it('cooldown window: memories surfaced in the last 5 reply turns, counting turns that surfaced nothing', () => {
    const reply = (turn: string, surfaced?: string[], extra: Record<string, unknown> = {}) => msg('assistant', `回复 ${turn}`, { turn, ...(surfaced ? { surfaced } : {}), ...extra });
    const h = [
      reply('t1', ['old']),
      msg('user', '在吗'), reply('t2', ['cat']),
      msg('user', '嗯'), reply('t3'), msg('assistant', '（拍了拍你）', { narration: true, turn: 't4' }), reply('t4'),
      msg('user', '好'), reply('t5'), reply('t5'),
      msg('user', '然后呢'), reply('t6', ['noodle']),
    ];
    // 最近 5 轮是 t2…t6：t1 带过的 old 已经冷却完了；一轮拆成几个气泡、带旁白，都只算一轮
    expect([...recentlySurfaced(h)].sort()).toEqual(['cat', 'noodle']);
    expect([...recentlySurfaced(h, 1)]).toEqual(['noodle']);
    // 删掉或重新生成那一轮，气泡没了，冷却跟着没了
    expect([...recentlySurfaced(h.slice(0, -1))].sort()).toEqual(['cat', 'old']);
    expect(recentlySurfaced([])).toEqual(new Set());
  });

  it('explains every hit with score, matched terms and a verdict that agrees with recallMemories', () => {
    const egg = M('egg', '方亦楷要{{user}}明早带一个加俩蛋的煎饼果子', { core: ['煎饼果子', '加俩蛋'] });
    const all = [...mems, egg];
    const q = '走走走 顺便再来一杯珍珠奶茶，加奶加茶加珍珠';
    // 单字「加」只在 hint 档：单字凑不成命中，连解释里都不出现
    expect(explainRecall(all, q).find((e) => e.memory.id === 'egg')).toBeUndefined();
    expect(recallMemories(all, q)).toEqual([]);
    const ex2 = explainRecall(all, '小姨子最近胖了没', new Set(['noodle']));
    expect(ex2[0]).toMatchObject({ status: 'recalled', terms: expect.arrayContaining(['小姨子']) });
    expect(explainRecall(all, '烤冷面还欠着呢', new Set(['noodle']))[0]!.status).toBe('pinned');
  });
});

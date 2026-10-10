import { describe, it, expect } from 'vitest';
import { assemble, loreDirectory } from './assemble';
import type { Campaign, Character, LoreEntry, LoreOverlay, Message, World } from '../storage/db';

const world: World = { id: 'w', name: '雨城', summary: '一座总在下雨的城市', createdAt: 0, updatedAt: 0 };
const ch: Character = { id: 'c', worldId: 'w', name: '林晚秋', core: '图书馆管理员', full: '' };
const campaign: Campaign = { id: 'cp', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: { c: '刚认识' }, mood: {}, facts: ['邮差昨天来过'] } };
const lore: LoreEntry[] = [
  { id: 'l1', worldId: 'w', title: '邮差', summary: '雨天出现的邮差', content: '信都是空的', scope: 'world', triggers: { keywords: ['邮差'] }, constant: false, order: 1, enabled: true },
  { id: 'l2', worldId: 'w', title: '城规', summary: '城市的基本规则', content: '晚上十点后不能出门', scope: 'world', triggers: { keywords: [] }, constant: true, order: 0, enabled: true },
];
const msg = (role: Message['role'], text: string, ts: number): Message => ({ id: String(ts), conversationId: 'x', role, content: [{ type: 'text', text }], ts });
const base = { world, campaign, characters: [ch], userName: '我', lore, overlays: [] as LoreOverlay[], highlights: [], now: new Date(2026, 9, 8, 9, 0) };

describe('assemble (full)', () => {
  it('builds L0 in fixed order with constant lore, directory and state; last system block cached', () => {
    const r = assemble({ ...base, history: [], userText: '嗨' });
    const titles = r.system.map((b) => b.text.split('\n')[0]);
    expect(titles).toEqual(['# 规则', '# 用户', '# 世界：雨城', '# 你扮演的角色：林晚秋', '# 当前状态', '# 世界书（常驻）', '# 世界书目录']);
    expect(r.system.at(-1)!.cache).toBe(true);
    expect(r.system.find((b) => b.text.startsWith('# 当前状态'))!.text).toContain('林晚秋 与用户的关系：刚认识');
    expect(r.system.find((b) => b.text.startsWith('# 世界书目录'))!.text).toContain('[l1] 邮差');
    expect(r.system.find((b) => b.text.startsWith('# 世界书目录'))!.text).not.toContain('城规');
  });

  it('injects L1 hits into the last user message only, never into system', () => {
    const r = assemble({ ...base, history: [msg('assistant', '你来了', 1)], userText: '那个邮差呢' });
    const sys = r.system.map((b) => b.text).join();
    expect(sys).not.toContain('信都是空的');
    const last = r.messages.at(-1)!;
    expect(last.role).toBe('user');
    const text = last.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('<世界书>');
    expect(text).toContain('信都是空的');
    expect(text).toContain('现在是');
    expect(text.endsWith('那个邮差呢')).toBe(true);
    expect(r.l1Hits).toEqual(['邮差']);
  });

  it('annotates overlays in the directory and uses overlay content for L1', () => {
    const ov: LoreOverlay = { id: 'o1', campaignId: 'cp', loreEntryId: 'l1', title: '邮差', summary: '邮差不再出现', content: '邮差死了', reason: '', createdAt: 0 };
    const pending: LoreOverlay = { ...ov, id: 'o2', loreEntryId: undefined, title: '新事', summary: '待确认', pending: true };
    expect(loreDirectory(lore, [ov, pending])).toContain('本局已变化，原为：雨天出现的邮差');
    expect(loreDirectory(lore, [ov, pending])).not.toContain('待确认');
    const r = assemble({ ...base, overlays: [ov, pending], history: [], userText: '邮差' });
    expect(r.messages.at(-1)!.content.map((b) => (b.type === 'text' ? b.text : '')).join()).toContain('邮差死了');
  });

  it('puts the second cache breakpoint on the second-to-last message', () => {
    const r = assemble({ ...base, history: [msg('user', 'a', 1), msg('assistant', 'b', 2)], userText: 'c' });
    const prev = r.messages.at(-2)!;
    const pb = prev.content.at(-1)!;
    expect(pb.type === 'text' && pb.cache).toBe(true);
  });
});

describe('style entries', () => {
  it('puts constant style entries after rules and triggered ones in a <风格> block, never in the directory', () => {
    const style: LoreEntry[] = [
      { id: 's1', worldId: 'w', title: '粤语', summary: '', content: '全程用粤语口语。', scope: 'world', kind: 'style', triggers: { keywords: [] }, constant: true, order: 0, enabled: true },
      { id: 's2', worldId: 'w', title: '雨天文风', summary: '', content: '下雨时句子更短。', scope: 'world', kind: 'style', triggers: { keywords: ['雨'] }, constant: false, order: 1, enabled: true },
    ];
    const r = assemble({ ...base, lore: [...lore, ...style], history: [], userText: '雨好大' });
    expect(r.system[1]!.text.startsWith('# 写作风格与附加指令')).toBe(true);
    expect(r.system.find((b) => b.text.startsWith('# 世界书目录'))!.text).not.toContain('雨天文风');
    const tail = r.messages.at(-1)!.content.map((b) => (b.type === 'text' ? b.text : '')).join();
    expect(tail).toContain('<风格>');
    expect(tail).toContain('句子更短');
    expect(r.l1Hits).toEqual([]);
  });
});

describe('tail style and chapter cut', () => {
  it('puts tail-position constant style entries at the end of the last user message, not in system', () => {
    const tail: LoreEntry = { id: 't1', worldId: 'global', title: '尾部', summary: '', content: '每条不超过十五个字。', scope: 'world', kind: 'style', position: 'tail', triggers: { keywords: [] }, constant: true, order: 0, enabled: true };
    const r = assemble({ ...base, lore: [tail], history: [], userText: '嗨' });
    expect(r.system.some((b) => b.text.includes('每条不超过十五个字'))).toBe(false);
    const last = r.messages.at(-1)!.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(last).toContain('<尾部指令>\n每条不超过十五个字。\n</尾部指令>');
    expect(last.indexOf('<尾部指令>')).toBeLessThan(last.indexOf('嗨'));
  });
  it('keeps only a few messages before the latest chapter marker', () => {
    const msg = (i: number, extra: Partial<Message> = {}): Message => ({ id: 'm' + i, conversationId: 'c', role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: '第' + i }], ts: i, ...extra });
    const history = [...Array.from({ length: 20 }, (_, i) => msg(i)), msg(20, { role: 'user', meta: { narration: true, chapter: true }, content: [{ type: 'text', text: '（时间来到：三天后）' }] }), msg(21), msg(22)];
    const r = assemble({ ...base, lore: [], history, userText: '现在呢', chapterTail: 4 });
    const text = r.messages.flatMap((m) => m.content.map((b) => (b.type === 'text' ? b.text : ''))).join('\n');
    expect(text).not.toContain('第15');
    expect(text).toContain('第16');
    expect(text).toContain('时间来到');
    expect(text).toContain('第22');
  });
});

describe('card alt in history', () => {
  it('keeps card-only replies in history via alt, and does not double user cardOnly text', () => {
    const card = { pluginId: 'redpacket', tag: 'redpacket', body: '{"id":"p1"}', attrs: {}, alt: '[发了一个红包：¥8.88，留言「生日快乐」]' };
    const history: Message[] = [
      { ...msg('user', '[发了一个红包：¥1.00，留言「拿去」]', 1), meta: { cardOnly: true, cards: [{ ...card, alt: '[红包] 拿去' }] } },
      { ...msg('assistant', '', 2), meta: { cards: [card] } },
      { ...msg('assistant', '生日快乐！', 3), meta: { cards: [{ ...card, alt: '[分享了歌：晴天 - 周杰伦]' }] } },
    ];
    const r = assemble({ ...base, history, userText: '谢谢' });
    const texts = r.messages.map((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n'));
    expect(texts[0]).toBe('[发了一个红包：¥1.00，留言「拿去」]');
    expect(texts[0]).not.toContain('[红包]');
    expect(texts[1]).toContain('[发了一个红包：¥8.88，留言「生日快乐」]');
    expect(texts[1]).toContain('生日快乐！\n[分享了歌：晴天 - 周杰伦]');
  });
});

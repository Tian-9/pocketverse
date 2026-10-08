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

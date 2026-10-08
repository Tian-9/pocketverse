import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import { applyOutput, buildPrompt } from './consolidate';
import type { Campaign, Character } from '../storage/db';

beforeAll(() => { openDB([]); });
const character: Character = { id: 'c', worldId: 'w', name: '林晚秋', core: 'x', full: '' };
const campaign: Campaign = { id: 'cp', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: ['旧事实'] } };

describe('consolidate', () => {
  it('builds a prompt containing state, directory, prior memories and transcript', () => {
    const p = buildPrompt(campaign, character, [{ id: 'l', worldId: 'w', title: '邮差', summary: '雨天的', content: '', scope: 'world', triggers: { keywords: [] }, constant: false, order: 0, enabled: true }],
      [{ id: 'm', conversationId: 'x', role: 'user', content: [{ type: 'text', text: '你好' }], ts: 1 }], []);
    expect(p.user).toContain('[l] 邮差');
    expect(p.user).toContain('用户：你好');
    expect(p.user).toContain('旧事实');
  });
  it('applies output: memories, state patch, pending overlays with validated loreEntryId', async () => {
    const r = await applyOutput(campaign, character, [], {
      memories: [{ text: '用户说自己怕黑', when: '今晚', importance: 2 }, { text: '', when: '', importance: 1 }],
      state: { mood: '安心', facts: ['新事实'] },
      overlays: [{ loreEntryId: 'nope', title: '钟楼塌了', summary: 's', content: 'c' }],
    }, ['m1']);
    expect(r.mems).toHaveLength(1);
    expect(r.state.mood.c).toBe('安心');
    expect(r.state.facts).toEqual(['新事实']);
    expect(r.overlays[0]!.loreEntryId).toBeUndefined();
    expect(r.overlays[0]!.pending).toBe(true);
    expect(await db().memories.count()).toBe(1);
    expect(await db().overlays.count()).toBe(1);
  });
});

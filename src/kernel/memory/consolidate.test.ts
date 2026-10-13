import { describe, it, expect, beforeAll, vi } from 'vitest';
import { openDB, db } from '../storage/db';
import { applyOutput, buildPrompt } from './consolidate';
import { loadState, stateLines } from './state';
import type { Campaign, Character } from '../storage/db';

beforeAll(() => { openDB([]); });
const character: Character = { id: 'c', name: '林晚秋', core: 'x', full: '' };
const campaign: Campaign = { id: 'cp', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: ['旧事实'] } };

describe('consolidate', () => {
  it('builds a prompt containing state, directory, prior memories and transcript', () => {
    const p = buildPrompt(campaign, character, [{ id: 'l', worldId: 'w', title: '邮差', summary: '雨天的', content: '', scope: 'world', triggers: { keywords: [] }, constant: false, order: 0, enabled: true }],
      [{ id: 'm', conversationId: 'x', role: 'user', content: [{ type: 'text', text: '你好' }], ts: 1 }], []);
    expect(p.user).toContain('[l] 邮差');
    expect(p.user).toContain('{{user}}：你好');
    expect(p.user).toContain('旧事实');
    const p2 = buildPrompt(campaign, character, [], [], [], { stateLines: ['猫 · 位置：客栈B'], vocab: ['猫', '黑炭'] });
    expect(p2.user).toContain('猫 · 位置：客栈B');
    expect(p2.user).toContain('猫、黑炭');
    expect(p2.system).toContain('patches');
  });
  it('applies output: memories, state patch, pending overlays with validated loreEntryId', async () => {
    const r = await applyOutput(campaign, character, [], {
      memories: [{ text: '用户说自己怕黑', when: '今晚', importance: 2, bag: { core: ['用户', '怕黑'], hint: ['夜里', 42] } }, { text: '', when: '', importance: 1 }],
      state: { mood: '安心' },
      patches: [{ entity: '猫', attr: '位置', value: '客栈B' }, { entity: '', attr: 'x', value: 'y' }],
      overlays: [{ loreEntryId: 'nope', title: '钟楼塌了', summary: 's', content: 'c' }],
    }, ['m1']);
    expect(r.mems).toHaveLength(1);
    expect(r.mems[0]!.bag).toEqual({ core: ['用户', '怕黑'], hint: ['夜里'] });
    expect(r.state.mood.c).toBe('安心');
    expect(r.state.facts).toEqual(['旧事实']);
    expect(r.patches).toHaveLength(1);
    expect(r.patches[0]!.source).toBe('m1');
    expect(await stateLines('cp')).toEqual(['猫 · 位置：客栈B']);
    expect((await loadState('cp'))[0]!.payload.value).toBe('客栈B');
    expect(r.overlays[0]!.loreEntryId).toBeUndefined();
    expect(r.overlays[0]!.pending).toBe(true);
    expect(await db().memories.count()).toBe(1);
    expect(await db().overlays.count()).toBe(1);
  });
});

describe('consolidate names', () => {
  it('stores the user’s name and 用户 as {{user}}', async () => {
    const r = await applyOutput({ ...campaign, id: 'cpn' }, character, [], {
      memories: [{ text: 'Hana 说自己怕黑，用户还说怕打雷', when: '今晚', importance: 2 }],
      state: { relation: '和Hana是同桌' },
      patches: [{ entity: '债务', attr: '欠款', value: '林晚秋 欠 Hana 一份烤冷面' }],
      overlays: [],
    }, ['m9'], 1, 'Hana');
    expect(r.mems[0]!.text).toBe('{{user}} 说自己怕黑，{{user}}还说怕打雷');
    expect(r.state.relations.c).toBe('和{{user}}是同桌');
    expect(r.patches[0]!.payload.value).toBe('林晚秋 欠 {{user}} 一份烤冷面');
  });
});

vi.mock('../llm/gateway.svelte', () => ({ llm: { configured: true, chat: vi.fn(), settings: {} } }));

describe('consolidate guards', () => {
  it('does not retry the same messages after a failure, and runs again once new messages arrive', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { consolidate } = await import('./consolidate');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    await db().worlds.add({ id: 'w2', name: 'w', summary: '', createdAt: 0, updatedAt: 0 });
    await db().characters.add({ ...character, id: 'c2' });
    await db().campaigns.add({ ...campaign, id: 'cp2', worldId: 'w2', characterIds: ['c2'] });
    await db().conversations.add({ id: 'cv2', campaignId: 'cp2', kind: 'chat', participantIds: ['c2'], pluginId: 'chat' });
    const msgs = Array.from({ length: 24 }, (_, i) => ({ id: 'm' + i, conversationId: 'cv2', role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: [{ type: 'text', text: '…' }], ts: 1000 + i }));
    await db().messages.bulkAdd(msgs);

    chat.mockResolvedValueOnce({ text: 'not json', stopReason: 'max_tokens', usage: {}, content: [], model: 'm' });
    expect(await consolidate('cv2')).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
    // 同一批消息：不再自动重试，标记在库里（刷新页面也不重来）
    expect((await db().campaigns.get('cp2'))!.consolidateFailedAt).toBe(1023);
    expect(await consolidate('cv2')).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
    // 失败点之后只有几条新回复：还是不试
    await db().messages.bulkAdd([{ id: 'f0', conversationId: 'cv2', role: 'user', content: [{ type: 'text', text: '…' }], ts: 1500 }, { id: 'f1', conversationId: 'cv2', role: 'assistant', content: [{ type: 'text', text: '…' }], ts: 1501 }]);
    expect(await consolidate('cv2')).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
    // 手动触发不受限制
    chat.mockResolvedValueOnce({ text: JSON.stringify({ memories: [], state: {}, overlays: [] }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    expect(await consolidate('cv2', { force: true })).toBe(true);
    expect((await db().campaigns.get('cp2'))!.consolidatedUpTo).toBe(1501);
    expect((await db().campaigns.get('cp2'))!.consolidateFailedAt).toBeUndefined();
    // 新来 12 条回复：正常再跑
    await db().messages.bulkAdd(Array.from({ length: 24 }, (_, i) => ({ id: 'n' + i, conversationId: 'cv2', role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: [{ type: 'text', text: '…' }], ts: 2000 + i })));
    chat.mockResolvedValueOnce({ text: JSON.stringify({ memories: [{ text: 'x', when: '', importance: 1 }], state: {}, overlays: [] }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    expect(await consolidate('cv2')).toBe(true);
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it('skips while a consolidation for the same conversation is in flight', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { consolidate } = await import('./consolidate');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    await db().messages.bulkAdd([{ id: 'p0', conversationId: 'cv2', role: 'user', content: [{ type: 'text', text: '…' }], ts: 3000 }, { id: 'p1', conversationId: 'cv2', role: 'assistant', content: [{ type: 'text', text: '…' }], ts: 3001 }]);
    let release!: (v: unknown) => void;
    chat.mockReturnValueOnce(new Promise((r) => (release = r)));
    const first = consolidate('cv2', { force: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(await consolidate('cv2', { force: true })).toBe(false);
    release({ text: JSON.stringify({ memories: [], state: {}, overlays: [] }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    expect(await first).toBe(true);
  });

  it('sends once when two checks start at the same moment', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { consolidate } = await import('./consolidate');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    chat.mockClear();
    await db().messages.bulkAdd(Array.from({ length: 24 }, (_, i) => ({ id: 'q' + i, conversationId: 'cv2', role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: [{ type: 'text', text: '…' }], ts: 4000 + i })));
    chat.mockResolvedValue({ text: JSON.stringify({ memories: [], state: {}, overlays: [] }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await Promise.all([consolidate('cv2', { reason: 'a' }), consolidate('cv2', { reason: 'b' })]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('returning to the home screen does not consolidate', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { chat: engine } = await import('../chat/engine.svelte');
    const { bus } = await import('../bus/bus');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    chat.mockClear();
    // 像导入酒馆记录那样直接写库，攒了一大批没整理的回复
    await db().messages.bulkAdd(Array.from({ length: 24 }, (_, i) => ({ id: 'h' + i, conversationId: 'cv2', role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: [{ type: 'text', text: '…' }], ts: 5000 + i })));
    await engine.boot();
    bus.emit('app.closed', { pluginId: 'characters' });
    await new Promise((r) => setTimeout(r, 50));
    expect(chat).not.toHaveBeenCalled();
  });
});

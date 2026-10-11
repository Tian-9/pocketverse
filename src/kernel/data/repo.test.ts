import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import { repo, textOf } from './repo';

beforeAll(() => { openDB([]); });

describe('repo', () => {
  it('creates character, a campaign in the default world on first chat, and a direct conversation with first message', async () => {
    const c = await repo.createCharacter({ name: '林晚秋', core: 'x', full: 'x', firstMessage: '你来了。', useFirstMessage: true });
    const conv1 = await repo.directConversation(c);
    expect((await db().worlds.count())).toBe(1);
    const conv2 = await repo.directConversation(c);
    expect(conv1.id).toBe(conv2.id);
    expect(await db().campaigns.count()).toBe(1);
    const msgs = await repo.messagesOf(conv1.id);
    expect(msgs).toHaveLength(1);
    expect(textOf(msgs[0]!)).toBe('你来了。');
    await repo.deleteCharacter(c.id);
    expect(await db().messages.count()).toBe(0);
    expect(await db().campaigns.count()).toBe(0);
  });

  it('one card can play in several worlds: each save has its own conversation, and the current pointer decides which one chat uses', async () => {
    const c = await repo.createCharacter({ name: '赫敏', core: 'x', full: 'x' });
    const first = await repo.campaignFor(c);
    const defaultWorld = await repo.ensureDefaultWorld();
    expect(first.worldId).toBe(defaultWorld.id);
    const conv1 = await repo.directConversation(c);

    const hogwarts = await repo.createWorld('霍格沃茨', '魔法学校');
    const second = await repo.newCampaign(c, hogwarts.id);
    expect(second.worldId).toBe(hogwarts.id);
    expect((await repo.campaignFor(c)).id).toBe(second.id);
    const conv2 = await repo.directConversation(c);
    expect(conv2.id).not.toBe(conv1.id);
    expect((await repo.campaignsOf(c.id)).map((x) => x.id)).toEqual([first.id, second.id]);
    expect([...(await repo.currentCampaignIds())]).toEqual([second.id]);

    // 世界被存档用着，删不掉；切回第一局后再删也不行，因为第二局还在
    expect(await repo.deleteWorld(hogwarts.id)).toBe(false);
    await repo.setCurrentCampaign(c.id, first.id);
    expect((await repo.directConversation(c)).id).toBe(conv1.id);
    await repo.deleteCampaign(second.id);
    expect(await repo.deleteWorld(hogwarts.id)).toBe(true);
    expect(await db().worlds.get(hogwarts.id)).toBeUndefined();
    await repo.deleteCharacter(c.id);
  });
});

describe('repo (story clock)', () => {
  it('stamps every message with the campaign clock and starts a save on a chosen day', async () => {
    const { clock } = await import('../context/clock');
    const c = await repo.createCharacter({ name: '时钟', core: 'x', full: 'x' });
    const w = await repo.createWorld('旧日', '');
    const D = 86400_000;
    const cp = await repo.newCampaign(c, w.id, Date.now() - 30 * D);
    expect(cp.clock?.running).toBe(true);
    expect(Math.abs(clock.now(cp.clock) - (Date.now() - 30 * D))).toBeLessThan(5000);
    const conv = await repo.directConversation(c);
    const m = await repo.addMessage(conv.id, 'user', '嗨');
    expect(m.storyTs).toBeDefined();
    expect(Math.abs(m.storyTs! - (m.ts - 30 * D))).toBeLessThan(5000);
    // 起点就是现在：不设时钟，和真实时间一样
    const cp2 = await repo.newCampaign(c, w.id, Date.now());
    expect(cp2.clock).toBeUndefined();
    const conv2 = await repo.directConversation(c);
    const m2 = await repo.addMessage(conv2.id, 'user', '嗨');
    expect(m2.storyTs).toBe(m2.ts);
    await repo.deleteCharacter(c.id);
  });
});

describe('repo (note on a card message)', () => {
  it('withNote appends the user line once; noteOf / previewOf / modelTextOf carry it', async () => {
    const { withNote, noteOf, previewOf, modelTextOf } = await import('./repo');
    expect(withNote('[分享了一件商品给你看]\n《吉他入门教程DVD》', '  你要不要学这个  ')).toBe('[分享了一件商品给你看]\n《吉他入门教程DVD》\n并说：「你要不要学这个」');
    expect(withNote('x', '')).toBe('x');
    expect(withNote('x', undefined)).toBe('x');
    const m = {
      id: 'm', conversationId: 'c', role: 'user' as const, ts: 1,
      content: [{ type: 'text', text: withNote('[分享了一件商品给你看]\n《吉他入门教程DVD》', '你要不要学这个') }],
      meta: { cardOnly: true, note: '你要不要学这个', cards: [{ pluginId: 'shop', tag: 'share', body: '{}', attrs: {}, alt: '[商品] 吉他入门教程DVD' }] },
    };
    expect(noteOf(m)).toBe('你要不要学这个');
    expect(previewOf(m)).toBe('[商品] 吉他入门教程DVD 你要不要学这个');
    expect(modelTextOf(m)).toContain('并说：「你要不要学这个」');
    expect(noteOf({ ...m, meta: { cardOnly: true } })).toBeUndefined();
  });
});

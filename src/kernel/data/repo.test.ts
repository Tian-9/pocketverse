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

import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import { repo, textOf } from './repo';

beforeAll(() => { openDB([]); });

describe('repo', () => {
  it('creates character in default world, one campaign and a direct conversation with first message', async () => {
    const c = await repo.createCharacter({ name: '林晚秋', core: 'x', full: 'x', firstMessage: '你来了。', useFirstMessage: true });
    expect((await db().worlds.count())).toBe(1);
    const conv1 = await repo.directConversation(c);
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
});

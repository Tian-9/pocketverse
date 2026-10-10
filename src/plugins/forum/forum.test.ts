import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext, CampaignView } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin, { forumApi, KEEP_CROWD } from './index';

const campaign: CampaignView = {
  id: 'cp1', name: '王都', worldId: 'w1', worldName: '王都', characterId: 'ch1', characterName: '阿一', lastPlayedAt: 1,
  state: { inWorldTime: '春分', location: '东市', relations: {}, mood: {}, facts: ['城门塌了'] },
};
let answer = '';
let lastUser = '';
const kv = new Map<string, unknown>();

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'forum',
    emit() {}, navigate() {}, back() {}, notify() {},
    settings: { async get(k: string, f: unknown) { return kv.has(k) ? kv.get(k) : f; }, async set(k: string, v: unknown) { kv.set(k, v); } },
    table: (name: string) => db().table(pluginTable('forum', name)),
    llm: { configured: true, async chat(req: { user: string }) { lastUser = req.user; return { text: answer }; } },
    data: {
      async currentCampaigns() { return [campaign]; },
      async campaign(id: string) { return id === campaign.id ? campaign : undefined; },
      async world() { return { id: 'w1', name: '王都', summary: '中世纪' }; },
      async character(id: string) { return id === 'ch1' ? { id, name: '阿一', core: '' } : undefined; },
      async characters() { return []; },
      async memories() { return [{ id: 'm', when: '', text: '国王病了', importance: 3 as const, createdAt: 1 }]; },
      async loreDirectory() { return '- [a] 王宫：很大'; },
    },
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
});

describe('forum refresh', () => {
  it('posts crowd threads with replies, answers the user thread, clears awaiting, stamps refreshedAt', async () => {
    const mine = await forumApi.post('cp1', { kind: 'user' }, '有人见过黑猫吗', '昨晚在巷子里', 'user');
    expect(mine.awaitingCrowd).toBe(true);
    answer = JSON.stringify({
      posts: [{ name: '面包师', title: '面包又涨价了', body: '离谱', tag: '吐槽', replies: [{ name: '老王', body: '习惯就好' }, { name: '小李', body: '+1' }] }],
      replies: [{ n: 1, items: [{ name: '猫奴', body: '我家的，别抓' }] }],
    });
    const r = await forumApi.refresh('cp1');
    expect(r).toEqual({ posts: 1, replies: 1 });
    for (const s of ['王都：中世纪', '王宫：很大', '春分', '东市', '城门塌了', '国王病了', '有人见过黑猫吗', '路过的人']) expect(lastUser).toContain(s);

    const threads = await forumApi.threads().where('campaignId').equals('cp1').sortBy('createdAt');
    const crowd = threads.find((t) => t.source === 'crowd')!;
    expect(crowd.title).toBe('面包又涨价了');
    expect(crowd.replyCount).toBe(2);
    expect(crowd.mine).toBeUndefined();
    const again = (await forumApi.threads().get(mine.id))!;
    expect(again.replyCount).toBe(1);
    expect(again.awaitingCrowd).toBe(false);
    expect(again.mine).toBe(true);
    const rs = await forumApi.replies().where('threadId').equals(mine.id).toArray();
    expect(rs[0]!.author).toEqual({ kind: 'npc', name: '猫奴' });
    expect(await forumApi.refreshedAt('cp1')).toBeGreaterThan(0);
    expect(await forumApi.refreshDue('cp1')).toBe(false);
  });

  it('poking one thread asks only for replies and does not stamp refreshedAt', async () => {
    kv.delete('refreshedAt.cp1');
    const mine = await forumApi.post('cp1', { kind: 'user' }, '问个路', '去城南怎么走', 'user');
    answer = JSON.stringify({ replies: [{ n: 1, items: [{ name: '车夫', body: '顺着河走' }] }] });
    const r = await forumApi.refresh('cp1', { threadId: mine.id });
    expect(r).toEqual({ posts: 0, replies: 1 });
    expect(lastUser).not.toContain('# 新帖');
    expect(lastUser).toContain('问个路');
    expect(await forumApi.refreshedAt('cp1')).toBe(0);
  });

  it('a reply on his thread is flagged for him; user reply re-opens awaiting', async () => {
    const his = await forumApi.post('cp1', { kind: 'char', characterId: 'ch1' }, '今天好累', '不想说话', 'chat');
    expect(his.mine).toBe(true);
    expect(his.awaitingCrowd).toBeUndefined();
    const r = await forumApi.reply(his, { kind: 'user' }, '抱抱');
    expect(r.pendingForChar).toBe(true);
    expect((await forumApi.threads().get(his.id))!.awaitingCrowd).toBe(true);
    expect(await forumApi.nameOf(his.author)).toBe('阿一');
  });

  it('prune keeps only the newest KEEP_CROWD untouched crowd threads', async () => {
    for (let i = 0; i < KEEP_CROWD + 5; i++) await forumApi.post('cp2', { kind: 'npc', name: 'n' }, `t${i}`, 'b', 'crowd', { lastReplyAt: i });
    const kept = await forumApi.post('cp2', { kind: 'npc', name: 'n' }, 'old-but-mine', 'b', 'crowd', { lastReplyAt: -1, mine: true });
    await forumApi.prune('cp2');
    const left = await forumApi.threads().where('campaignId').equals('cp2').toArray();
    expect(left).toHaveLength(KEEP_CROWD + 1);
    expect(left.some((t) => t.id === kept.id)).toBe(true);
    expect(left.some((t) => t.title === 't0')).toBe(false);
  });
});

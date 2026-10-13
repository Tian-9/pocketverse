import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext, CampaignView } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin, { forumApi, KEEP_CROWD } from './index';
import { tools, volatile, collectBrowse, collectReplies } from './character';
import type { PromptContext, CatchupContext } from '$kernel/api';

const campaign: CampaignView = {
  id: 'cp1', name: '王都', worldId: 'w1', worldName: '王都', characterId: 'ch1', characterName: '阿一', lastPlayedAt: 1,
  now: Date.UTC(2026, 2, 20, 4, 0), aligned: false, userName: '我', state: { location: '东市', relations: {}, mood: {}, facts: ['城门塌了'] },
};
let answer = '';
let lastUser = '';
/** 模型调用中途要做的事（测占位、测失败） */
let onChat: (() => Promise<void>) | null = null;
const kv = new Map<string, unknown>();

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'forum',
    emit() {}, navigate() {}, back() {}, notify() {},
    settings: { async get(k: string, f: unknown) { return kv.has(k) ? kv.get(k) : f; }, async set(k: string, v: unknown) { kv.set(k, v); } },
    table: (name: string) => db().table(pluginTable('forum', name)),
    llm: { configured: true, async chat(req: { user: string }) { lastUser = req.user; if (onChat) await onChat(); return { text: answer }; } },
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
    for (const s of ['王都：中世纪', '王宫：很大', '2026/3/20', '东市', '城门塌了', '国王病了', '有人见过黑猫吗', '路过的人']) expect(lastUser).toContain(s);

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

  it('claims refreshedAt before calling the model, so a second opening does not refresh again; gives it back when the call fails', async () => {
    kv.delete('refreshedAt.cp1');
    expect(await forumApi.refreshDue('cp1')).toBe(true);
    let dueDuringCall: boolean | null = null;
    onChat = async () => { dueDuringCall = await forumApi.refreshDue('cp1'); };
    answer = JSON.stringify({ posts: [{ name: '更夫', title: '夜里谁在敲锣', body: '吵死了', tag: '吐槽', replies: [] }] });
    expect(await forumApi.refresh('cp1')).toEqual({ posts: 1, replies: 0 });
    expect(dueDuringCall).toBe(false);

    kv.set('refreshedAt.cp1', 123);
    onChat = async () => { throw new Error('断网了'); };
    await expect(forumApi.refresh('cp1')).rejects.toThrow('断网了');
    expect(await forumApi.refreshedAt('cp1')).toBe(123);
    onChat = null;
  });

  it('drops posts whose title the forum already has, and duplicates inside one batch', async () => {
    kv.delete('refreshedAt.cp1');
    const before = await forumApi.threads().where('campaignId').equals('cp1').count();
    answer = JSON.stringify({ posts: [
      { name: '甲', title: '《面包又涨价了》', body: '又来', tag: '吐槽', replies: [] },
      { name: '乙', title: '井水变咸了', body: '谁知道', tag: '求助', replies: [{ name: '丙', body: '我家也是' }] },
      { name: '丁', title: '井水变咸了', body: '再问一遍', tag: '求助', replies: [] },
    ] });
    expect(await forumApi.refresh('cp1')).toEqual({ posts: 1, replies: 0 });
    const after = await forumApi.threads().where('campaignId').equals('cp1').toArray();
    expect(after.length - before).toBe(1);
    expect(after.filter((t) => t.title === '井水变咸了')).toHaveLength(1);
    expect(after.filter((t) => t.title.includes('面包又涨价了'))).toHaveLength(1);
    expect(lastUser).toContain('标题和事情都别重复');
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

const pctx: PromptContext = { campaignId: 'cp3', conversationId: 'cv', characterIds: ['ch1'], now: Date.now() };
const cctx: CatchupContext = { campaignId: 'cp3', characterId: 'ch1', characterName: '阿一', elapsedMs: 8 * 3600_000, from: Date.now() - 8 * 3600_000, to: Date.now(), now: Date.now(), days: 0, tier: 'h6', elapsedText: '大约 8 小时' };
const tool = (name: string) => tools.find((t) => t.name === name)!;

describe('forum: the character on the forum', () => {
  it('browse lists, searches, reads by number; post makes a thread and replies by number', async () => {
    expect(await tool('forum_browse').handler({}, pctx)).toBe('论坛上还没有帖子。');
    await forumApi.post('cp3', { kind: 'npc', name: '老王' }, '面包涨价', '离谱啊', 'crowd', { lastReplyAt: 1 });
    const list = String(await tool('forum_browse').handler({}, pctx));
    expect(list).toContain('1. 《面包涨价》 老王');
    expect(String(await tool('forum_browse').handler({ query: '黑猫' }, pctx))).toContain('没有和「黑猫」有关');
    expect(String(await tool('forum_browse').handler({ n: 1 }, pctx))).toContain('离谱啊');
    expect(String(await tool('forum_browse').handler({ n: 9 }, pctx))).toContain('没有第 9 个');

    expect(await tool('forum_post').handler({ body: '没标题' }, pctx)).toContain('要有 title');
    expect(await tool('forum_post').handler({ title: '今天好累', body: '不想说话' }, pctx)).toBe('已发到论坛。');
    const mine = (await forumApi.threads().where('campaignId').equals('cp3').toArray()).find((t) => t.author.kind === 'char')!;
    expect(mine.source).toBe('chat');
    // 新帖排到了第 1，回第 2 个（老王的）
    expect(await tool('forum_post').handler({ n: 2, body: '确实' }, pctx)).toBe('已回复到《面包涨价》。');
    const v = await volatile(pctx);
    expect(v).toContain('你发了《今天好累》');
    expect(v).not.toContain('还没看');
  });

  it('attach: pending replies on his thread get answered or dismissed, never asked twice', async () => {
    const mine = (await forumApi.threads().where('campaignId').equals('cp3').toArray()).find((t) => t.author.kind === 'char')!;
    await forumApi.reply(mine, { kind: 'user' }, '抱抱');
    await forumApi.reply(mine, { kind: 'npc', name: '路人甲' }, '怎么了');
    expect(await volatile(pctx)).toContain('2 条你还没看');
    const item = (await collectReplies(cctx))!;
    expect(item.prompt).toContain('路过的人 回复：「抱抱」');
    expect(item.prompt).toContain('路人甲 回复：「怎么了」');
    await item.apply({ replies: [{ n: 1, reply: '谢谢' }, { n: 2, reply: '' }] }, cctx);
    const rs = await forumApi.replies().where('threadId').equals(mine.id).sortBy('createdAt');
    expect(rs.filter((r) => r.pendingForChar)).toHaveLength(0);
    expect(rs.at(-1)!.author).toEqual({ kind: 'char', characterId: 'ch1' });
    expect(rs.at(-1)!.body).toBe('谢谢');
    expect(await collectReplies(cctx)).toBeNull();
  });

  it('catchup browse: skipped right after he posted; otherwise he can reply to a numbered thread or post anew', async () => {
    expect(await collectBrowse(cctx)).toBeNull(); // 刚发过《今天好累》
    const mine = (await forumApi.threads().where('campaignId').equals('cp3').toArray()).find((t) => t.author.kind === 'char')!;
    await forumApi.threads().update(mine.id, { createdAt: Date.now() - 7 * 3600_000, storyTs: Date.now() - 7 * 3600_000 });
    const item = (await collectBrowse(cctx))!;
    expect(item.prompt).toContain('《面包涨价》');
    await item.apply({ act: true, reply_to: 0, title: '', text: '今晚月亮很圆' }, cctx);
    const posted = (await forumApi.threads().where('campaignId').equals('cp3').toArray()).find((t) => t.source === 'catchup')!;
    expect(posted.title).toBe('今晚月亮很圆');
    await item.apply({ act: false, reply_to: 0, title: '', text: '不会落库' }, cctx);
    expect((await forumApi.threads().where('campaignId').equals('cp3').toArray()).filter((t) => t.source === 'catchup')).toHaveLength(1);
  });
});

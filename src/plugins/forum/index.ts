import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext } from '$kernel/api';
import { ulid } from 'ulid';
import Forum from './Forum.svelte';
import ThreadScreen from './Thread.svelte';
import ForumSection from './ForumSection.svelte';
import { CROWD_SYSTEM, crowdUser, crowdSchema, parseCrowd, type WaitingThread } from './crowd';
import { tools, volatile, collectBrowse, collectReplies } from './character';
import { postResolver } from './share';
import PostPicker from './PostPicker.svelte';

/** 谁写的：路人（只有网名）、他（角色）、你 */
export type Author = { kind: 'npc'; name: string } | { kind: 'char'; characterId: string } | { kind: 'user' };

export interface Thread {
  id: string; campaignId: string;
  author: Author; title: string; body: string;
  /** 话题标签，生成时给的 */
  tag?: string;
  createdAt: number; lastReplyAt: number; replyCount: number;
  source: 'crowd' | 'chat' | 'catchup' | 'user';
  /** 你或他参与过（发的或回过）：清理旧路人帖时留下 */
  mine?: boolean;
  /** 最后一条是你写的，等下次刷新时路人来接话 */
  awaitingCrowd?: boolean;
}

export interface Reply {
  id: string; threadId: string; campaignId: string;
  author: Author; body: string; createdAt: number;
  /** 回在他帖子下、他还没看到；他下次拿起手机时处理 */
  pendingForChar?: boolean;
}

let ctx: PluginContext;
/** 打开论坛时距上次刷新超过这么久就自动刷一批 */
export const REFRESH_EVERY = 6 * 3600_000;
/** 每存档最多留多少没人参与的路人帖 */
export const KEEP_CROWD = 50;
const NEW_POSTS = 5;
const DEFAULT_NICKNAME = '路过的人';

const refreshing = new Set<string>();

export const forumApi = {
  ctx: () => ctx,
  threads: () => ctx.table<Thread>('threads'),
  replies: () => ctx.table<Reply>('replies'),
  nickname: () => ctx.settings.get('nickname', DEFAULT_NICKNAME),
  setNickname: (v: string) => ctx.settings.set('nickname', v.trim() || DEFAULT_NICKNAME),
  lastCampaign: () => ctx.settings.get<string | null>('campaign', null),
  setLastCampaign: (id: string) => ctx.settings.set('campaign', id),

  /** 作者显示名 */
  async nameOf(a: Author): Promise<string> {
    if (a.kind === 'npc') return a.name;
    if (a.kind === 'user') return this.nickname();
    return (await ctx.data.character(a.characterId))?.name ?? '他';
  },

  async post(campaignId: string, author: Author, title: string, body: string, source: Thread['source'], extra: Partial<Thread> = {}): Promise<Thread> {
    const now = Date.now();
    const t: Thread = {
      id: ulid(), campaignId, author, title: title.trim().slice(0, 60), body: body.trim().slice(0, 2000),
      createdAt: now, lastReplyAt: now, replyCount: 0, source,
      ...(author.kind !== 'npc' ? { mine: true } : {}),
      ...(author.kind === 'user' ? { awaitingCrowd: true } : {}),
      ...extra,
    };
    await this.threads().add(t);
    return t;
  },

  async reply(thread: Thread, author: Author, body: string, at = Date.now()): Promise<Reply> {
    const r: Reply = {
      id: ulid(), threadId: thread.id, campaignId: thread.campaignId, author, body: body.trim().slice(0, 1000), createdAt: at,
      ...(thread.author.kind === 'char' && author.kind !== 'char' ? { pendingForChar: true } : {}),
    };
    await this.replies().add(r);
    const patch: Partial<Thread> = { lastReplyAt: Math.max(thread.lastReplyAt, at), replyCount: thread.replyCount + 1 };
    if (author.kind !== 'npc') patch.mine = true;
    if (author.kind === 'user') patch.awaitingCrowd = true;
    else if (author.kind === 'npc') patch.awaitingCrowd = false;
    await this.threads().update(thread.id, patch);
    return r;
  },

  async remove(threadId: string) {
    await this.replies().where('threadId').equals(threadId).delete();
    await this.threads().delete(threadId);
  },

  async refreshedAt(campaignId: string) { return ctx.settings.get<number>(`refreshedAt.${campaignId}`, 0); },
  async refreshDue(campaignId: string) { return Date.now() - (await this.refreshedAt(campaignId)) >= REFRESH_EVERY; },
  isRefreshing: (campaignId: string) => refreshing.has(campaignId),

  /**
   * 刷一批路人：发几个新帖 + 给等着的帖子回复。一次调用，便宜模型。
   * 传 threadId 时只给那一个帖子找人回，不发新帖（帖子页的「看看有没有人回」）。
   */
  async refresh(campaignId: string, opts: { threadId?: string } = {}): Promise<{ posts: number; replies: number } | null> {
    if (!ctx.llm.configured || refreshing.has(campaignId)) return null;
    refreshing.add(campaignId);
    try {
      const cp = await ctx.data.campaign(campaignId);
      if (!cp) return null;
      const [world, dir, mems, nickname] = await Promise.all([
        ctx.data.world(cp.worldId), ctx.data.loreDirectory(campaignId), ctx.data.memories(campaignId, { limit: 6, minImportance: 2 }), this.nickname(),
      ]);
      const all = await this.threads().where('campaignId').equals(campaignId).reverse().sortBy('lastReplyAt');
      const waitingThreads = opts.threadId ? all.filter((t) => t.id === opts.threadId) : all.filter((t) => t.awaitingCrowd).slice(0, 5);
      const waiting: WaitingThread[] = [];
      for (const [i, t] of waitingThreads.entries()) {
        const rs = await this.replies().where('threadId').equals(t.id).sortBy('createdAt');
        const named = await Promise.all(rs.slice(-6).map(async (r) => ({ name: await this.nameOf(r.author), body: r.body })));
        waiting.push({ n: i + 1, title: t.title, body: t.body.slice(0, 300), replies: named });
      }
      const newPosts = opts.threadId ? 0 : NEW_POSTS;
      if (!newPosts && !waiting.length) return { posts: 0, replies: 0 };
      const { text } = await ctx.llm.chat({
        system: CROWD_SYSTEM,
        user: crowdUser({
          worldName: world?.name ?? cp.worldName, worldSummary: world?.summary ?? '', loreDirectory: dir.slice(0, 3000),
          time: cp.state.inWorldTime || new Date().toLocaleString('zh-CN', { hour12: false }), location: cp.state.location,
          happenings: [...cp.state.facts, ...mems.map((m) => m.text)].slice(0, 10),
          recentTitles: all.slice(0, 12).map((t) => t.title), newPosts, waiting, nickname,
        }),
        cheap: true, effort: 'low', maxTokens: 2500, jsonSchema: crowdSchema(newPosts > 0, waiting.length > 0),
      });
      const out = parseCrowd(text);
      let replies = 0;
      // 新帖的回复时间往前错开一点，列表里看着像陆续发的
      const now = Date.now();
      for (const [i, p] of out.posts.entries()) {
        const at = now - (out.posts.length - i) * 7 * 60_000;
        const t = await this.post(campaignId, { kind: 'npc', name: p.name }, p.title, p.body, 'crowd', { tag: p.tag, createdAt: at, lastReplyAt: at });
        let cur = t;
        for (const [j, r] of p.replies.entries()) {
          await this.reply(cur, { kind: 'npc', name: r.name }, r.body, at + (j + 1) * 90_000);
          cur = { ...cur, replyCount: cur.replyCount + 1, lastReplyAt: at + (j + 1) * 90_000 };
        }
      }
      for (const r of out.replies) {
        let t = waitingThreads[r.n - 1];
        if (!t) continue;
        for (const [j, item] of r.items.entries()) {
          await this.reply(t, { kind: 'npc', name: item.name }, item.body, now + j * 1000);
          t = { ...t, replyCount: t.replyCount + 1 };
          replies++;
        }
      }
      // 没人接话的也别一直挂着，下次刷新再说
      for (const t of waitingThreads) if (!out.replies.some((r) => r.n === waitingThreads.indexOf(t) + 1)) await this.threads().update(t.id, { awaitingCrowd: false });
      if (!opts.threadId) {
        await ctx.settings.set(`refreshedAt.${campaignId}`, now);
        await this.prune(campaignId);
      }
      return { posts: out.posts.length, replies };
    } finally { refreshing.delete(campaignId); }
  },

  /** 只留最近 KEEP_CROWD 个没人参与的路人帖 */
  async prune(campaignId: string) {
    const crowd = (await this.threads().where('campaignId').equals(campaignId).reverse().sortBy('lastReplyAt')).filter((t) => t.source === 'crowd' && !t.mine);
    for (const t of crowd.slice(KEEP_CROWD)) await this.remove(t.id);
  },
};

export default definePlugin({
  id: 'forum',
  name: '论坛',
  version: '0.3.0',
  description: '这个世界的本地论坛：路人在上面发帖吵架，你和他都能发帖回帖；他离开回来会刷一刷，也会回他帖子下的评论。',
  app: { screen: Forum, icon: { paths: icons.forum, background: gradients.teal } },
  screens: { thread: ThreadScreen },
  storage: { tables: { threads: 'id, campaignId, lastReplyAt', replies: 'id, threadId, campaignId, createdAt' } },
  profileSections: [{ id: 'latest', component: ForumSection }],
  shares: [postResolver],
  composerActions: [{ id: 'post', label: '帖子', icon: { paths: icons.forum, background: gradients.teal }, component: PostPicker }],
  promptContributors: [{ id: 'my-threads', volatile }],
  tools,
  catchup: [
    { id: 'browse', tier: 'h6', collect: collectBrowse },
    { id: 'replies', tier: 'attach', collect: collectReplies },
  ],
  setup(c) { ctx = c; },
});

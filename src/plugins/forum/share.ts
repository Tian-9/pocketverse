/**
 * 帖子当分享卡：他用内核 share 工具分享（type: post），你从「+」面板挑一帖发给他。
 * 两边产出同一种 ShareCard，聊天插件用通用卡片渲染，点卡片进帖子页。
 */
import type { ShareCard, ShareResolver, ShareQuery, ShareContext } from '$kernel/api';
import { forumApi, type Thread, type Reply } from './index';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
const norm = (s: string) => s.replace(/[《》「」""''\s]/g, '').toLowerCase();

/** 按标题找帖：全等优先，再前缀/包含；都没有返回 undefined */
export function findThread(threads: Thread[], title: string): Thread | undefined {
  const q = norm(title);
  if (!q) return undefined;
  return threads.find((t) => norm(t.title) === q) ?? threads.find((t) => norm(t.title).includes(q) || q.includes(norm(t.title)));
}

/** quote 必须是帖子正文或某条回复里的原话，否则丢掉 */
export function validQuote(quote: string | undefined, thread: Thread, replies: Reply[]): string | undefined {
  const q = quote?.trim();
  if (!q) return undefined;
  return thread.body.includes(q) || replies.some((r) => r.body.includes(q)) ? q : undefined;
}

export function buildCard(thread: Thread, who: string, quote?: string): ShareCard {
  return {
    type: 'post', title: thread.title, subtitle: `${who} · ${thread.replyCount} 回复`,
    excerpt: clip(thread.body.replace(/\s+/g, ' '), 60), ...(quote ? { quote } : {}),
    source: 'forum', open: { pluginId: 'forum', screen: 'thread', params: { id: thread.id } },
  };
}

/** 给模型看的全文：正文 + 最近几条回复 */
export async function forModel(thread: Thread, replies: Reply[]): Promise<string> {
  const who = await forumApi.nameOf(thread.author);
  const rs = await Promise.all(replies.slice(-8).map(async (r, i) => `${i + 1}楼 ${await forumApi.nameOf(r.author)}：${r.body}`));
  return `《${thread.title}》 ${who}\n${thread.body}${rs.length ? '\n\n回复：\n' + rs.join('\n') : '\n\n（还没有回复）'}`;
}

export const postResolver: ShareResolver = {
  type: 'post',
  label: '帖子',
  hint: 'post：本地论坛上的一个帖子。title 填帖子标题（要和 forum_browse 里看到的一致），quote 填想引用的一句原话（可不填）',
  async resolve(q: ShareQuery, ctx: ShareContext) {
    const threads = await forumApi.threads().where('campaignId').equals(ctx.campaignId).reverse().sortBy('lastReplyAt');
    const t = findThread(threads, q.title);
    if (!t) throw new Error(`论坛上没有叫《${q.title}》的帖子，不要编。先用 forum_browse 看看有什么。`);
    const replies = await forumApi.replies().where('threadId').equals(t.id).sortBy('createdAt');
    const quote = validQuote(q.quote, t, replies);
    const text = await forModel(t, replies);
    return {
      card: buildCard(t, await forumApi.nameOf(t.author), quote),
      forModel: text + (q.quote && !quote ? '\n\n（你想引的那句不在原文里，已去掉，不要再说）' : ''),
    };
  },
};

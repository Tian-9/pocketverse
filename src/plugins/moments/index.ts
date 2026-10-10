import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext } from '$kernel/api';
import { ulid } from 'ulid';
import Moments from './Moments.svelte';
import MomentCard from './MomentCard.svelte';

export interface Post {
  id: string; campaignId: string; characterId: string; text: string;
  createdAt: number; liked: boolean; comments: { by: 'user' | 'char'; text: string; ts: number }[];
  /** 来源：对话里发的 / 补发的 / 手动生成 */
  source: 'chat' | 'catchup' | 'manual';
  /** 用户评论了、角色还没看到；补发时一起处理，处理过（回了或决定不回）就清掉 */
  pendingReply?: boolean;
}

let ctx: PluginContext;
const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const momentsApi = {
  posts: () => ctx.table<Post>('posts'),
  async add(post: Omit<Post, 'id' | 'liked' | 'comments'>) {
    const p: Post = { ...post, id: ulid(), liked: false, comments: [] };
    await ctx.table<Post>('posts').add(p);
    ctx.emit('moments_posted', { postId: p.id, characterId: p.characterId });
    return p;
  },
  /** 用户评论：挂起等角色下次"拿起手机"时处理 */
  async comment(post: Post, text: string) {
    await ctx.table<Post>('posts').update(post.id, { comments: [...post.comments, { by: 'user', text, ts: Date.now() }], pendingReply: true });
  },
  /** 手动：让角色现在发一条（补发走内核 catchup，不经这里） */
  async generate(campaignId: string, characterId: string, hint: string, source: Post['source']) {
    if (!ctx.llm.configured) return null;
    const { db } = await import('$kernel/storage/db');
    const ch = await db().characters.get(characterId);
    const cp = await db().campaigns.get(campaignId);
    if (!ch || !cp) return null;
    const mems = await db().memories.where('campaignId').equals(campaignId).reverse().sortBy('createdAt');
    const recent = await ctx.table<Post>('posts').where('campaignId').equals(campaignId).reverse().sortBy('createdAt');
    const { text } = await ctx.llm.chat({
      system: `你是「${ch.name}」。设定：${ch.core.slice(0, 800)}\n你要在自己的朋友圈发一条动态。像真人发朋友圈：一两句话，口语，可以有一点情绪或者只是一件小事，不要解释，不要带话题标签，不要提到"用户"或"你"。只输出动态正文。`,
      user: `${hint}\n\n最近发生的事：\n${mems.slice(0, 6).map((m) => '- ' + m.text).join('\n') || '（没什么特别的）'}\n\n你之前发过的（别重复）：\n${recent.slice(0, 3).map((p) => '- ' + p.text).join('\n') || '（无）'}\n现在的情绪：${cp.state.mood[characterId] ?? '平常'}`,
      maxTokens: 200, effort: 'low',
    });
    const body = text.trim().replace(/^["“「]|["”」]$/g, '');
    if (!body) return null;
    return this.add({ campaignId, characterId, text: body, createdAt: Date.now(), source });
  },
};

/** 补发 · 发一条：离开 ≥ 6 小时，这段时间他自己过了什么 */
async function collectPost(c: CatchupContext) {
  const recent = await ctx.table<Post>('posts').where('campaignId').equals(c.campaignId).reverse().sortBy('createdAt');
  if (recent[0] && Date.now() - recent[0].createdAt < 6 * 3600_000) return null; // 刚发过
  return {
    label: '朋友圈',
    prompt: `这${c.elapsedText}你自己过了些什么？想发就发一条朋友圈：一两句话，口语，可以只是一件小事，不要话题标签。没什么想说的就不发（post 填 false，text 留空）。\n你之前发过的（别重复）：\n${recent.slice(0, 3).map((p) => '- ' + p.text).join('\n') || '（无）'}`,
    schema: { type: 'object', additionalProperties: false, required: ['post', 'text'], properties: { post: { type: 'boolean', description: '发不发' }, text: { type: 'string', description: '动态正文，不发留空' } } },
    async apply(out: unknown, cc: CatchupContext) {
      const o = out as { post?: boolean; text?: string } | undefined;
      const text = String(o?.text ?? '').trim().replace(/^["“「]|["”」]$/g, '').slice(0, 500);
      if (!o?.post || !text) return;
      await momentsApi.add({ campaignId: cc.campaignId, characterId: cc.characterId, text, createdAt: Date.now(), source: 'catchup' });
      ctx.notify(`${cc.characterName} 发了一条朋友圈`, text, 'app');
    },
  };
}

/** 补发 · 回评论：依附档，有补发就一起看看谁评论了；不回的也标记掉，以后不再拿出来 */
async function collectReplies(c: CatchupContext) {
  const pending = (await ctx.table<Post>('posts').where('campaignId').equals(c.campaignId).filter((p) => !!p.pendingReply).sortBy('createdAt')).slice(-5);
  if (!pending.length) return null;
  const lines = pending.map((p, i) => {
    const lastChar = p.comments.map((x, j) => (x.by === 'char' ? j : -1)).reduce((a, b) => Math.max(a, b), -1);
    const fresh = p.comments.slice(lastChar + 1).filter((x) => x.by === 'user');
    return `${i + 1}. 你 ${fmtTime(p.createdAt)} 发的「${p.text}」${p.liked ? '（对方点了赞）' : ''}\n   对方评论：${fresh.map((x) => '「' + x.text + '」').join(' ')}`;
  });
  return {
    label: '朋友圈评论',
    prompt: `对方在你的朋友圈下留了评论：\n${lines.join('\n')}\n像真人回评论：一般都会回一句，短一点，口语，接对方的话茬；确实没什么可说的才把 reply 留空，留空以后不会再提醒你。按编号 n 回，每条都要有一项。`,
    schema: { type: 'object', additionalProperties: false, required: ['replies'], properties: { replies: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'reply'], properties: { n: { type: 'integer' }, reply: { type: 'string', description: '回复内容，不回留空' } } } } } },
    async apply(out: unknown, cc: CatchupContext) {
      const replies = ((out as { replies?: { n?: number; reply?: string }[] } | undefined)?.replies ?? []);
      let replied = 0;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i]!;
        const r = String(replies.find((x) => x.n === i + 1)?.reply ?? '').trim().slice(0, 300);
        const patch: Partial<Post> = { pendingReply: false };
        if (r) { patch.comments = [...p.comments, { by: 'char', text: r, ts: Date.now() }]; replied++; }
        await ctx.table<Post>('posts').update(p.id, patch);
      }
      if (replied) ctx.notify(`${cc.characterName} 回复了你的评论`, replied > 1 ? `${replied} 条` : undefined, 'app');
    },
  };
}

export default definePlugin({
  id: 'moments',
  name: '朋友圈',
  version: '0.4.0',
  description: '角色会发动态；离开一段时间回来会补发、回评论；你的点赞评论他聊天时也知道。',
  app: { screen: Moments, icon: { paths: icons.clock, background: gradients.yellow } },
  storage: { tables: { posts: 'id, campaignId, characterId, createdAt' } },
  promptContributors: [{
    id: 'recent-moments',
    async volatile(p: PromptContext) {
      // 只带最近两天的和还没回评论的，老动态他自己翻，不然每轮都看到同一条就反复提
      const fresh = Date.now() - 48 * 3600_000;
      const posts = (await ctx.table<Post>('posts').where('campaignId').equals(p.campaignId).reverse().sortBy('createdAt')).filter((x) => x.createdAt >= fresh || x.pendingReply);
      if (!posts.length) return '';
      const lines = posts.slice(0, 3).map((x) => `- ${fmtTime(x.createdAt)}：${x.text}${x.liked ? '（用户点了赞）' : ''}${x.comments.length ? '；评论：' + x.comments.map((c) => (c.by === 'user' ? '用户' : '你') + '「' + c.text + '」').join('，') : ''}${x.pendingReply ? '（用户的评论你还没回，见「顺手处理的事」）' : ''}`);
      return `<你最近发的朋友圈>\n${lines.join('\n')}\n</你最近发的朋友圈>`;
    },
  }],
  tools: [{
    name: 'moments_post',
    label: '发朋友圈',
    description: '发一条朋友圈动态。只在角色真的想发的时候用，比如聊到一件值得记录的事，或者想让用户在朋友圈看到什么。一轮最多一条。',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '动态正文，一两句话' } }, required: ['text'] },
    async handler(input: unknown, p: PromptContext) {
      const text = String((input as { text?: unknown })?.text ?? '').trim().slice(0, 500);
      if (!text) return '正文不能为空';
      const characterId = p.characterIds[0]!;
      await momentsApi.add({ campaignId: p.campaignId, characterId, text, createdAt: Date.now(), source: 'chat' });
      return '已发布到朋友圈。';
    },
  }],
  outputHandlers: [{
    tag: 'moment',
    component: MomentCard,
    async onParsed(body, _attrs, p) {
      if (!body.trim()) return;
      await momentsApi.add({ campaignId: p.campaignId, characterId: p.characterIds[0]!, text: body.trim().slice(0, 500), createdAt: Date.now(), source: 'chat' });
    },
  }],
  catchup: [
    { id: 'post', tier: 'h6', collect: collectPost },
    { id: 'replies', tier: 'attach', collect: collectReplies },
  ],
  setup(c) { ctx = c; },
});

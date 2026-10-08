import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext } from '$kernel/api';
import { ulid } from 'ulid';
import Moments from './Moments.svelte';
import MomentCard from './MomentCard.svelte';

export interface Post {
  id: string; campaignId: string; characterId: string; text: string;
  createdAt: number; liked: boolean; comments: { by: 'user' | 'char'; text: string; ts: number }[];
  /** 来源：对话里发的 / 补发的 / 手动生成 */
  source: 'chat' | 'catchup' | 'manual';
}

let ctx: PluginContext;
export const momentsApi = {
  posts: () => ctx.table<Post>('posts'),
  async add(post: Omit<Post, 'id' | 'liked' | 'comments'>) {
    const p: Post = { ...post, id: ulid(), liked: false, comments: [] };
    await ctx.table<Post>('posts').add(p);
    ctx.emit('moments.posted', { postId: p.id, characterId: p.characterId });
    return p;
  },
  /** 让角色基于最近的记忆发一条动态 */
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

export default definePlugin({
  id: 'moments',
  name: '朋友圈',
  version: '0.3.0',
  description: '角色会发动态；离开一段时间回来会补发；可以点赞评论，内容注入提示词。',
  app: { screen: Moments, icon: { paths: icons.clock, background: gradients.yellow } },
  storage: { tables: { posts: 'id, campaignId, characterId, createdAt' } },
  promptContributors: [{
    id: 'recent-moments',
    async volatile(p: PromptContext) {
      const posts = await ctx.table<Post>('posts').where('campaignId').equals(p.campaignId).reverse().sortBy('createdAt');
      if (!posts.length) return '';
      const lines = posts.slice(0, 3).map((x) => `- ${new Date(x.createdAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}：${x.text}${x.liked ? '（用户点了赞）' : ''}${x.comments.length ? '；评论：' + x.comments.map((c) => (c.by === 'user' ? '用户' : '你') + '「' + c.text + '」').join('，') : ''}`);
      return `<你最近发的朋友圈>\n${lines.join('\n')}\n</你最近发的朋友圈>`;
    },
  }],
  tools: [{
    name: 'moments.post',
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
  onEvent: {
    async 'app.resumed'({ elapsedMs }) {
      const minGap = await ctx.settings.get('catchupHours', 3);
      if (elapsedMs < minGap * 3600 * 1000) return;
      const campaigns = await ctx.activeCampaigns();
      let budget = 3;
      for (const c of campaigns.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)) {
        if (budget-- <= 0) break;
        const last = await ctx.table<Post>('posts').where('campaignId').equals(c.campaignId).reverse().sortBy('createdAt');
        if (last[0] && Date.now() - last[0].createdAt < minGap * 3600 * 1000) continue;
        const hours = Math.round(elapsedMs / 3600000);
        const post = await momentsApi.generate(c.campaignId, c.characterId, `用户离开了大约 ${hours} 小时。这段时间你自己过了些什么，发一条。`, 'catchup').catch((e) => { console.warn('[moments] catchup', e); return null; });
        if (post) ctx.notify(`${c.characterName} 发了一条朋友圈`, post.text, 'app');
      }
    },
  },
  setup(c) { ctx = c; },
});

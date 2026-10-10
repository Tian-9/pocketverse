/**
 * 他上论坛：聊天里的工具、补发（刷论坛发帖或回帖）、依附档回他帖子下的评论、给提示词的易变段。
 * 这里只拼材料和落库，模型调用都由内核做。
 */
import type { PromptContext, CatchupContext, CatchupItem, ToolDef } from '$kernel/api';
import { forumApi, type Thread, type Reply } from './index';

const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/** 给模型看的帖子列表：编号、标题、谁发的、几条回复、开头 */
async function listing(threads: Thread[], characterId: string): Promise<string> {
  const lines = await Promise.all(threads.map(async (t, i) => {
    const who = t.author.kind === 'char' && t.author.characterId === characterId ? '你自己' : await forumApi.nameOf(t.author);
    return `${i + 1}. 《${t.title}》 ${who} · ${t.replyCount} 回复 · ${fmtTime(t.lastReplyAt)}\n   ${clip(t.body.replace(/\s+/g, ' '), 80)}`;
  }));
  return lines.join('\n');
}

async function threadText(t: Thread, characterId: string): Promise<string> {
  const rs = await forumApi.replies().where('threadId').equals(t.id).sortBy('createdAt');
  const name = async (a: Thread['author']) => (a.kind === 'char' && a.characterId === characterId ? '你自己' : forumApi.nameOf(a));
  const head = `《${t.title}》 ${await name(t.author)} · ${fmtTime(t.createdAt)}\n${t.body}`;
  const body = await Promise.all(rs.slice(-20).map(async (r, i) => `${i + 1}楼 ${await name(r.author)}：${r.body}`));
  return head + (body.length ? '\n\n回复：\n' + body.join('\n') : '\n\n（还没有回复）');
}

/** 这一局最近活跃的帖子 */
const recent = (campaignId: string, n: number) => forumApi.threads().where('campaignId').equals(campaignId).reverse().sortBy('lastReplyAt').then((xs) => xs.slice(0, n));

export const tools: ToolDef[] = [
  {
    name: 'forum_browse',
    label: '刷论坛',
    description: '看看本地论坛。不带参数返回最近的热帖列表（带编号）；带 query 按关键词搜标题和正文；带 n 读某一帖的全文和回复。只在聊到论坛上的事、或者想找点话题时用。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '关键词，可不填' }, n: { type: 'integer', description: '上一次列表里的编号，读这一帖' } } },
    async handler(input: unknown, p: PromptContext) {
      const { query, n } = (input ?? {}) as { query?: unknown; n?: unknown };
      const characterId = p.characterIds[0]!;
      const all = await recent(p.campaignId, 12);
      if (Number.isInteger(n) && (n as number) >= 1) {
        const t = all[(n as number) - 1];
        return t ? threadText(t, characterId) : `列表里没有第 ${n} 个帖子。`;
      }
      const q = String(query ?? '').trim();
      const hits = q ? all.filter((t) => t.title.includes(q) || t.body.includes(q)) : all.slice(0, 8);
      if (!hits.length) return q ? `论坛上没有和「${q}」有关的帖子。` : '论坛上还没有帖子。';
      return (await listing(hits, characterId)) + '\n\n要看全文就用 n 读那一帖。';
    },
  },
  {
    name: 'forum_post',
    label: '发帖',
    description: '在本地论坛上发一帖（给 title 和 body），或者回某一帖（给 n 和 body，n 是 forum_browse 列表里的编号）。论坛是匿名的，用你自己的口吻，别暴露和对方的私事。只在真的想发的时候用，一轮最多一次。',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: '发新帖时的标题' }, body: { type: 'string', description: '正文或回复' }, n: { type: 'integer', description: '回帖时：列表里的编号' } }, required: ['body'] },
    async handler(input: unknown, p: PromptContext) {
      const { title, body, n } = (input ?? {}) as { title?: unknown; body?: unknown; n?: unknown };
      const text = String(body ?? '').trim();
      if (!text) return '正文不能为空';
      const characterId = p.characterIds[0]!;
      if (Number.isInteger(n) && (n as number) >= 1) {
        const t = (await recent(p.campaignId, 12))[(n as number) - 1];
        if (!t) return `列表里没有第 ${n} 个帖子。`;
        await forumApi.reply(t, { kind: 'char', characterId }, text);
        return `已回复到《${t.title}》。`;
      }
      const tt = String(title ?? '').trim();
      if (!tt) return '发新帖要有 title；回帖要给 n。';
      await forumApi.post(p.campaignId, { kind: 'char', characterId }, tt, text, 'chat');
      return '已发到论坛。';
    },
  },
];

/** 易变段：他最近两天自己发的帖和还没看的回复，一两行 */
export async function volatile(p: PromptContext): Promise<string> {
  const characterId = p.characterIds[0]!;
  const fresh = Date.now() - 48 * 3600_000;
  const mine = (await forumApi.threads().where('campaignId').equals(p.campaignId).reverse().sortBy('createdAt'))
    .filter((t) => t.author.kind === 'char' && t.author.characterId === characterId && t.createdAt >= fresh).slice(0, 3);
  if (!mine.length) return '';
  const lines = await Promise.all(mine.map(async (t) => {
    const pending = await forumApi.replies().where('threadId').equals(t.id).filter((r) => !!r.pendingForChar).count();
    return `- ${fmtTime(t.createdAt)} 你发了《${t.title}》，${t.replyCount} 条回复${pending ? `（${pending} 条你还没看，见「顺手处理的事」）` : ''}`;
  }));
  return `<你最近在论坛发的>\n${lines.join('\n')}\n</你最近在论坛发的>`;
}

/** 补发 · 刷论坛（h6）：看看热帖，想说就发一帖或回一帖，不想就算 */
export async function collectBrowse(c: CatchupContext): Promise<CatchupItem | null> {
  const threads = await recent(c.campaignId, 8);
  if (!threads.length) return null;
  const myLast = threads.find((t) => t.author.kind === 'char' && t.author.characterId === c.characterId);
  if (myLast && Date.now() - myLast.createdAt < 6 * 3600_000) return null; // 刚发过
  return {
    label: '论坛',
    prompt: `这${c.elapsedText}你也刷了会本地论坛。最近的帖子：\n${await listing(threads, c.characterId)}\n\n想说点什么就说：回其中一帖（reply_to 填编号，text 填回复），或者自己发一帖（reply_to 填 0，title 和 text 都填）。论坛是匿名的，用你的口吻，别提和对方之间的私事。没什么想说的就 act 填 false。`,
    schema: { type: 'object', additionalProperties: false, required: ['act', 'reply_to', 'title', 'text'], properties: {
      act: { type: 'boolean', description: '发不发' }, reply_to: { type: 'integer', description: '回哪一帖的编号，发新帖填 0' },
      title: { type: 'string', description: '新帖标题，回帖留空' }, text: { type: 'string', description: '正文或回复，不发留空' },
    } },
    async apply(out: unknown, cc: CatchupContext) {
      const o = out as { act?: boolean; reply_to?: number; title?: string; text?: string } | undefined;
      const text = String(o?.text ?? '').trim();
      if (!o?.act || !text) return;
      const n = Number(o.reply_to ?? 0);
      const author = { kind: 'char' as const, characterId: cc.characterId };
      if (n >= 1 && threads[n - 1]) {
        const t = threads[n - 1]!;
        await forumApi.reply(t, author, text);
        forumApi.ctx().notify(`${cc.characterName} 在论坛回了一帖`, `《${t.title}》：${clip(text, 40)}`, 'app');
      } else {
        const title = String(o.title ?? '').trim() || clip(text, 20);
        await forumApi.post(cc.campaignId, author, title, text, 'catchup');
        forumApi.ctx().notify(`${cc.characterName} 在论坛发了一帖`, title, 'app');
      }
    },
  };
}

/** 补发 · 回他帖子下的评论（依附档）：路人的和你的都看，回不回他定；看过就不再提醒 */
export async function collectReplies(c: CatchupContext): Promise<CatchupItem | null> {
  const pending = (await forumApi.replies().where('campaignId').equals(c.campaignId).filter((r) => !!r.pendingForChar).sortBy('createdAt')).slice(-6);
  if (!pending.length) return null;
  const threads = new Map<string, Thread>();
  for (const r of pending) if (!threads.has(r.threadId)) { const t = await forumApi.threads().get(r.threadId); if (t) threads.set(r.threadId, t); }
  const items = pending.filter((r) => threads.has(r.threadId));
  if (!items.length) return null;
  const lines = await Promise.all(items.map(async (r, i) => `${i + 1}. 《${threads.get(r.threadId)!.title}》下 ${await forumApi.nameOf(r.author)} 回复：「${r.body}」`));
  return {
    label: '论坛回复',
    prompt: `你在论坛发的帖子下有新回复：\n${lines.join('\n')}\n像在论坛上回人：短，口语，可以不回。按编号 n 回，每条都要有一项，不回 reply 留空，留空以后不会再提醒你。回复的人里可能有对方（网名你不认识），一视同仁。`,
    schema: { type: 'object', additionalProperties: false, required: ['replies'], properties: { replies: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'reply'], properties: { n: { type: 'integer' }, reply: { type: 'string', description: '回复内容，不回留空' } } } } } },
    async apply(out: unknown, cc: CatchupContext) {
      const replies = (out as { replies?: { n?: number; reply?: string }[] } | undefined)?.replies ?? [];
      let replied = 0;
      const seen = new Map<string, Thread>(threads);
      for (const [i, r] of items.entries()) {
        await forumApi.replies().update(r.id, { pendingForChar: false } as Partial<Reply>);
        const text = String(replies.find((x) => x.n === i + 1)?.reply ?? '').trim().slice(0, 300);
        if (!text) continue;
        const t = seen.get(r.threadId)!;
        await forumApi.reply(t, { kind: 'char', characterId: cc.characterId }, text);
        seen.set(t.id, { ...t, replyCount: t.replyCount + 1 });
        replied++;
      }
      if (replied) forumApi.ctx().notify(`${cc.characterName} 在论坛回了你`, replied > 1 ? `${replied} 条` : undefined, 'app');
    },
  };
}

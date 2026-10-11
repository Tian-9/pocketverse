/**
 * 路人生成：一次便宜模型调用，产出一批新帖（各带几条回复）和给等着的帖子的回复。
 * 这里只做纯函数（拼提示词、定 schema、解析结果），不碰库，方便测。
 */

export interface WaitingThread {
  /** 编号，模型按它回 */
  n: number;
  title: string;
  body: string;
  /** 已有的回复，谁说的 + 说了什么 */
  replies: { name: string; body: string }[];
}

export interface CrowdMaterial {
  worldName: string;
  worldSummary: string;
  /** 条目目录，可以为空 */
  loreDirectory: string;
  /** 剧情时间，没有就用真实时间 */
  time: string;
  location?: string;
  /** 这一局当前事实 + 近期要事 */
  happenings: string[];
  /** 已有的帖子标题，别重复 */
  recentTitles: string[];
  /** 要生成几个新帖，0 表示不发新帖 */
  newPosts: number;
  /** 等路人接话的帖子 */
  waiting: WaitingThread[];
  /** 用户在论坛上的网名；路人把他当普通网友 */
  nickname: string;
}

export interface CrowdPost { name: string; title: string; body: string; tag?: string; replies: { name: string; body: string }[] }
export interface CrowdOutput { posts: CrowdPost[]; replies: { n: number; items: { name: string; body: string }[] }[] }

export const CROWD_SYSTEM = `你在模拟一个本地论坛上的一群路人网友。给定这个世界的设定和最近发生的事，写出他们发的帖子和回复。
要求：
- 像真实论坛：标题短，正文口语、一两段，有的在问、有的在吐槽、有的在传小道消息，立场各异，会跑题、会抬杠，偶尔有人说错。
- 每个发帖人、回帖人用不同的网名，网名要符合这个世界的气质，不要带编号。
- 可以聊世界设定里的东西，也可以聊柴米油盐。最近发生的事可以作为传闻出现，但路人不知道内情，只能猜。
- 话题要散开：一批新帖里最多一两个和「最近发生的事」沾边，其余聊设定里别的地方、物件、行当和日常琐事。已经有人发过的事别再发一遍，换个角度也不行。
- 不要出现「用户」「角色」「AI」「模型」这些词，不要解释，不要加表情符号堆砌。
- 严格按给定的 JSON 结构输出。`;

const list = (xs: string[], empty: string) => (xs.length ? xs.map((x) => '- ' + x).join('\n') : empty);

export function crowdUser(m: CrowdMaterial): string {
  const parts = [
    `# 这个世界\n${m.worldName}${m.worldSummary ? '：' + m.worldSummary : ''}`,
  ];
  if (m.loreDirectory) parts.push(`# 设定目录（可聊可不聊）\n${m.loreDirectory}`);
  parts.push(`# 现在\n时间：${m.time}${m.location ? '\n大家主要在聊的地方：' + m.location : ''}\n最近发生的事（路人只知道个大概）：\n${list(m.happenings, '（没什么大事）')}`);
  if (m.newPosts > 0) parts.push(`# 新帖\n写 ${m.newPosts} 个新帖，每个带 2 到 4 条回复。下面这些帖子论坛上已经有了，标题和事情都别重复，另找话题：\n${list(m.recentTitles, '（无）')}`);
  if (m.waiting.length) {
    const lines = m.waiting.map((w) => `${w.n}. 《${w.title}》\n   正文：${w.body}\n   已有回复：${w.replies.length ? w.replies.map((r) => `${r.name}「${r.body}」`).join('；') : '（还没有）'}`);
    parts.push(`# 等人接话的帖子\n网名「${m.nickname}」是个普通网友，和别人一样对待。下面这些帖子最后一条是他发的或他回的，给每个写 1 到 3 条路人回复，接着话茬：\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

export function crowdSchema(newPosts: boolean, waiting: boolean): Record<string, unknown> {
  const reply = { type: 'object', additionalProperties: false, required: ['name', 'body'], properties: { name: { type: 'string', description: '网名' }, body: { type: 'string', description: '回复内容' } } };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (newPosts) {
    required.push('posts');
    properties.posts = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'title', 'body', 'tag', 'replies'], properties: {
      name: { type: 'string', description: '发帖人网名' }, title: { type: 'string' }, body: { type: 'string' },
      tag: { type: 'string', description: '两三个字的话题标签，如 闲聊、求助、八卦' }, replies: { type: 'array', items: reply },
    } } };
  }
  if (waiting) {
    required.push('replies');
    properties.replies = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'items'], properties: { n: { type: 'integer', description: '帖子编号' }, items: { type: 'array', items: reply } } } };
  }
  return { type: 'object', additionalProperties: false, required, properties };
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** 解析模型输出：丢掉缺字段的项，截长度；解析不出来返回空结果而不是抛 */
export function parseCrowd(text: string): CrowdOutput {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { posts: [], replies: [] }; }
  const o = (raw ?? {}) as { posts?: unknown; replies?: unknown };
  const replyList = (xs: unknown) => (Array.isArray(xs) ? xs : [])
    .map((r) => ({ name: str((r as { name?: unknown })?.name, 24), body: str((r as { body?: unknown })?.body, 400) }))
    .filter((r) => r.name && r.body);
  const posts: CrowdPost[] = (Array.isArray(o.posts) ? o.posts : []).map((p) => {
    const x = p as { name?: unknown; title?: unknown; body?: unknown; tag?: unknown; replies?: unknown };
    const tag = str(x.tag, 8);
    return { name: str(x.name, 24), title: str(x.title, 60), body: str(x.body, 1200), ...(tag ? { tag } : {}), replies: replyList(x.replies) };
  }).filter((p) => p.name && p.title && p.body);
  const replies = (Array.isArray(o.replies) ? o.replies : []).map((r) => {
    const x = r as { n?: unknown; items?: unknown };
    return { n: Number(x.n), items: replyList(x.items) };
  }).filter((r) => Number.isInteger(r.n) && r.items.length);
  return { posts, replies };
}

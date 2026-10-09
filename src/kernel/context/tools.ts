import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { Campaign, Character, LoreEntry, LoreOverlay } from '../storage/db';
import type { ToolSpec } from '../llm/types';
import { search } from './search';
import { runMemoryCommand, type MemCommand } from './memfs';
import { bus } from '../bus/bus';
import { expandMacros } from './macros';
import { chat } from '../chat/engine.svelte';
import { registry } from '../registry/registry.svelte';
import type { ShareCard, ShareResolver } from '../share/types';
import type { CatchupContext, CatchupItem } from '../api/types';
import { log } from '../log/log';

export interface AttachedTask { key: string; item: CatchupItem; ctx: CatchupContext }
export interface ToolContext {
  campaign: Campaign; characters: Character[]; lore: LoreEntry[]; overlays: LoreOverlay[];
  /** 本轮工具产生的分享卡，引擎收完写进消息 meta */
  cards: ShareCard[];
  /** 挂在这一轮上顺手处理的事（如回朋友圈评论），材料在最后一条用户消息里 */
  attached: AttachedTask[];
}
export type ToolHandler = (input: any, ctx: ToolContext) => Promise<string>;
export interface KernelTool { spec: ToolSpec; handler: ToolHandler; /** UI 状态文案 */ label: string }

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

export const kernelTools: KernelTool[] = [
  {
    label: '翻世界书',
    spec: { name: 'lore_search', description: '按关键词搜索世界书和本局的世界变化，返回条目 id、标题和摘要。要读正文用 lore_read。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索词，可以是几个关键词' } }, required: ['query'] } },
    async handler(input, ctx) {
      const active = ctx.overlays.filter((o) => !o.pending);
      const docs = [
        ...ctx.lore.filter((e) => e.enabled && e.kind !== 'style').map((e) => ({ id: e.id, kind: 'lore', title: e.title, text: e.summary + '\n' + e.content })),
        ...active.map((o) => ({ id: o.id, kind: 'overlay', title: o.title, text: o.summary + '\n' + o.content })),
      ];
      const hits = search(docs, str(input?.query, 200));
      if (!hits.length) return '没有找到相关条目。';
      return expandForModel(hits.map((h) => {
        const d = docs.find((x) => x.id === h.id)!;
        return `[${d.id}] ${d.title}${d.kind === 'overlay' ? '（本局变化）' : ''}：${d.text.split('\n')[0]}`;
      }).join('\n'), ctx);
    },
  },
  {
    label: '读世界书',
    spec: { name: 'lore_read', description: '读一条世界书条目的正文。若本局对它有变化，返回变化后的版本并注明原文。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    async handler(input, ctx) {
      const id = str(input?.id, 64);
      const ov = ctx.overlays.find((o) => !o.pending && (o.id === id || o.loreEntryId === id));
      const e = ctx.lore.find((x) => x.id === id && x.kind !== 'style');
      if (ov && e) return expandForModel(`## ${e.title}（本局已变化）\n${ov.content}\n\n原文：${e.content}`, ctx);
      if (ov) return expandForModel(`## ${ov.title}（本局新增）\n${ov.content}`, ctx);
      if (e) return expandForModel(`## ${e.title}\n${e.content}`, ctx);
      return '没有这个条目。';
    },
  },
  {
    label: '回忆',
    spec: { name: 'memory_search', description: '搜索以前发生过的事（情节记忆）。', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    async handler(input, ctx) {
      const mems = await db().memories.where('campaignId').equals(ctx.campaign.id).toArray();
      const hits = search(mems.map((m) => ({ id: m.id, kind: 'mem', title: m.when, text: m.text })), str(input?.query, 200), 10);
      if (!hits.length) return '没有相关记忆。';
      return hits.map((h) => { const m = mems.find((x) => x.id === h.id)!; return `- ${m.when ? m.when + '：' : ''}${m.text}`; }).join('\n');
    },
  },
  {
    label: '回忆',
    spec: { name: 'memory_recent', description: '最近发生的事，按时间倒序。', inputSchema: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 30 } } } },
    async handler(input, ctx) {
      const n = Math.min(30, Math.max(1, Number(input?.n) || 10));
      const mems = await db().memories.where('campaignId').equals(ctx.campaign.id).reverse().sortBy('createdAt');
      if (!mems.length) return '还没有记忆。';
      return mems.slice(0, n).map((m) => `- ${m.when ? m.when + '：' : ''}${m.text}`).join('\n');
    },
  },
  {
    label: '看角色设定',
    spec: { name: 'character_read', description: '读在场角色的完整设定和示例对话。', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    async handler(input, ctx) {
      const name = str(input?.name, 50);
      const c = ctx.characters.find((x) => x.name === name) ?? ctx.characters[0];
      return c ? expandForModel(`## ${c.name}\n${c.full || c.core}`, ctx) : '没有这个角色。';
    },
  },
  {
    label: '记下变化',
    spec: {
      name: 'state_update',
      description: '更新当前状态：剧情时间、地点、角色与用户的关系、角色情绪、当前事实。只在有明确变化时调用。facts 是替换而不是追加，传完整列表（最多 20 条）。',
      inputSchema: { type: 'object', properties: {
        inWorldTime: { type: 'string' }, location: { type: 'string' },
        relation: { type: 'string', description: '你扮演的角色与用户现在的关系，一句话' },
        mood: { type: 'string', description: '你扮演的角色现在的情绪，一句话' },
        facts: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      } },
    },
    async handler(input, ctx) {
      const me = ctx.characters[0]?.id;
      const s = { ...ctx.campaign.state, relations: { ...ctx.campaign.state.relations }, mood: { ...ctx.campaign.state.mood } };
      if (typeof input?.inWorldTime === 'string') s.inWorldTime = input.inWorldTime.slice(0, 80);
      if (typeof input?.location === 'string') s.location = input.location.slice(0, 80);
      if (me && typeof input?.relation === 'string') s.relations[me] = input.relation.slice(0, 120);
      if (me && typeof input?.mood === 'string') s.mood[me] = input.mood.slice(0, 120);
      if (Array.isArray(input?.facts)) s.facts = input.facts.filter((f: unknown) => typeof f === 'string').map((f: string) => f.slice(0, 160)).slice(0, 20);
      await db().campaigns.update(ctx.campaign.id, { state: s });
      ctx.campaign.state = s;
      bus.emit('memory.written', { kind: 'state', id: ctx.campaign.id });
      return '已更新状态。';
    },
  },
  {
    label: '记下世界变化',
    spec: {
      name: 'overlay_write',
      description: '记录剧情导致的世界变化。loreEntryId 指向被改变的世界书条目；没有对应条目就留空表示新增事实。',
      inputSchema: { type: 'object', properties: {
        loreEntryId: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string', description: '一句话' }, content: { type: 'string' }, reason: { type: 'string', description: '是什么剧情导致的' },
      }, required: ['title', 'summary', 'content'] },
    },
    async handler(input, ctx) {
      const loreEntryId = str(input?.loreEntryId, 64) || undefined;
      if (loreEntryId && !ctx.lore.some((e) => e.id === loreEntryId)) return '没有这个世界书条目，loreEntryId 留空即可。';
      const ov: LoreOverlay = {
        id: ulid(), campaignId: ctx.campaign.id, loreEntryId, title: str(input?.title, 80), summary: str(input?.summary, 200),
        content: str(input?.content, 4000), reason: str(input?.reason, 200), createdAt: Date.now(),
      };
      // 角色自己写的覆盖直接生效；合并任务提的才需要确认
      await db().overlays.add(ov);
      ctx.overlays.push(ov);
      bus.emit('memory.written', { kind: 'overlay', id: ov.id });
      return `已记录：${ov.title}`;
    },
  },
  {
    label: '翻笔记',
    spec: { name: 'memory', builtin: 'memory' },
    async handler(input, ctx) {
      return runMemoryCommand(ctx.campaign.id, input as MemCommand);
    },
  },
];

/**
 * share 工具：按已启用插件的分享解析器动态生成（type 枚举随插件变），所以不在 kernelTools 里。
 * 没有任何解析器就不给模型这个工具。
 */
export function shareTool(resolvers: ShareResolver[]): KernelTool | null {
  if (!resolvers.length) return null;
  const types = resolvers.map((r) => r.type);
  return {
    label: '分享',
    spec: {
      name: 'share',
      description: '在聊天里分享一样东西给对方，像微信里转发一首歌。插件会去查真实资料返回给你，并把卡片直接发给对方（你不用再描述卡片）。只在聊天里自然想分享时用，一轮最多一次。\n' + resolvers.map((r) => `- ${r.hint}`).join('\n'),
      inputSchema: { type: 'object', properties: {
        type: { type: 'string', enum: types },
        title: { type: 'string', description: '名字，如歌名' },
        subtitle: { type: 'string', description: '歌手 / 作者 / 来源，知道就填' },
        quote: { type: 'string', description: '想引用的一句原文（如一句歌词），可不填。会在查到的原文里校验，没有的会被去掉' },
      }, required: ['type', 'title'] },
    },
    async handler(input, ctx) {
      const type = str(input?.type, 32);
      const r = resolvers.find((x) => x.type === type);
      if (!r) return `没有「${type}」这种分享类型，可选：${types.join('、')}`;
      const title = str(input?.title, 120).trim();
      if (!title) return 'title 不能为空';
      const res = await r.resolve({ type, title, subtitle: str(input?.subtitle, 120).trim() || undefined, quote: str(input?.quote, 200).trim() || undefined });
      ctx.cards.push(res.card);
      return expandForModel(res.forModel, ctx);
    },
  };
}

/**
 * handle_attached：处理"挂在这一轮上"的事。工具表要稳定（缓存前缀），所以有依附登记就一直挂着，
 * 每一轮具体有没有事、按什么结构提交，写在最后一条用户消息里。
 */
export const attachedTool: KernelTool = {
  label: '顺手处理',
  spec: {
    name: 'handle_attached',
    description: '处理最后一条消息里「顺手处理的事」。每件事有一个 key 和要求的结构，按结构把结果放在 output 里提交，一件事调一次。没有列出来的事不要调。',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, output: { type: 'object', additionalProperties: true } }, required: ['key', 'output'] },
  },
  async handler(input, ctx) {
    const key = str(input?.key, 64);
    const t = ctx.attached.find((x) => x.key === key);
    if (!t) return `这一轮没有 key 为「${key}」的事。`;
    await t.item.apply(input?.output, t.ctx);
    ctx.attached = ctx.attached.filter((x) => x !== t);
    log.info('catchup', `聊天里顺手处理了 ${t.item.label}`, { campaignId: t.ctx.campaignId, key });
    return `${t.item.label} 已处理。`;
  },
};

/** 给最后一条用户消息的材料：每件事的说明和提交结构 */
export function attachedPrompt(tasks: AttachedTask[]): string {
  if (!tasks.length) return '';
  return '<顺手处理的事>\n你在回消息，顺便把这些也处理了。每件事用 handle_attached 工具提交，key 和结构如下；处理完再正常回复消息，不要在消息里复述。\n\n'
    + tasks.map((t) => `## ${t.item.label}（key：${t.key}）\n${t.item.prompt}\n提交结构（output）：${JSON.stringify(t.item.schema)}`).join('\n\n')
    + '\n</顺手处理的事>';
}

/** 工具返回给模型的文本也要替换占位符 */
export function expandForModel(text: string, ctx: ToolContext): string {
  return expandMacros(text, { user: chat.userName, char: ctx.characters[0]?.name ?? '角色' });
}

const EXTRA_LABELS: Record<string, string> = { share: '分享', handle_attached: '顺手处理', web_search: '上网搜', web_fetch: '看网页' };

export function toolLabel(name: string): string {
  const k = kernelTools.find((t) => t.spec.name === name)?.label ?? EXTRA_LABELS[name];
  if (k) return k;
  for (const p of registry.plugins) {
    const t = p.tools?.find((x) => x.name === name);
    if (t) return t.label ?? `${p.name}：${name.split('_').pop()}`;
  }
  return name;
}

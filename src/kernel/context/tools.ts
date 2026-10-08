import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { Campaign, Character, LoreEntry, LoreOverlay } from '../storage/db';
import type { ToolSpec } from '../llm/types';
import { search } from './search';
import { runMemoryCommand, type MemCommand } from './memfs';
import { bus } from '../bus/bus';

export interface ToolContext { campaign: Campaign; characters: Character[]; lore: LoreEntry[]; overlays: LoreOverlay[] }
export type ToolHandler = (input: any, ctx: ToolContext) => Promise<string>;
export interface KernelTool { spec: ToolSpec; handler: ToolHandler; /** UI 状态文案 */ label: string }

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

export const kernelTools: KernelTool[] = [
  {
    label: '翻世界书',
    spec: { name: 'lore.search', description: '按关键词搜索世界书和本局的世界变化，返回条目 id、标题和摘要。要读正文用 lore.read。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索词，可以是几个关键词' } }, required: ['query'] } },
    async handler(input, ctx) {
      const active = ctx.overlays.filter((o) => !o.pending);
      const docs = [
        ...ctx.lore.filter((e) => e.enabled).map((e) => ({ id: e.id, kind: 'lore', title: e.title, text: e.summary + '\n' + e.content })),
        ...active.map((o) => ({ id: o.id, kind: 'overlay', title: o.title, text: o.summary + '\n' + o.content })),
      ];
      const hits = search(docs, str(input?.query, 200));
      if (!hits.length) return '没有找到相关条目。';
      return hits.map((h) => {
        const d = docs.find((x) => x.id === h.id)!;
        return `[${d.id}] ${d.title}${d.kind === 'overlay' ? '（本局变化）' : ''}：${d.text.split('\n')[0]}`;
      }).join('\n');
    },
  },
  {
    label: '读世界书',
    spec: { name: 'lore.read', description: '读一条世界书条目的正文。若本局对它有变化，返回变化后的版本并注明原文。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    async handler(input, ctx) {
      const id = str(input?.id, 64);
      const ov = ctx.overlays.find((o) => !o.pending && (o.id === id || o.loreEntryId === id));
      const e = ctx.lore.find((x) => x.id === id);
      if (ov && e) return `## ${e.title}（本局已变化）\n${ov.content}\n\n原文：${e.content}`;
      if (ov) return `## ${ov.title}（本局新增）\n${ov.content}`;
      if (e) return `## ${e.title}\n${e.content}`;
      return '没有这个条目。';
    },
  },
  {
    label: '回忆',
    spec: { name: 'memory.search', description: '搜索以前发生过的事（情节记忆）。', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    async handler(input, ctx) {
      const mems = await db().memories.where('campaignId').equals(ctx.campaign.id).toArray();
      const hits = search(mems.map((m) => ({ id: m.id, kind: 'mem', title: m.when, text: m.text })), str(input?.query, 200), 10);
      if (!hits.length) return '没有相关记忆。';
      return hits.map((h) => { const m = mems.find((x) => x.id === h.id)!; return `- ${m.when ? m.when + '：' : ''}${m.text}`; }).join('\n');
    },
  },
  {
    label: '回忆',
    spec: { name: 'memory.recent', description: '最近发生的事，按时间倒序。', inputSchema: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 30 } } } },
    async handler(input, ctx) {
      const n = Math.min(30, Math.max(1, Number(input?.n) || 10));
      const mems = await db().memories.where('campaignId').equals(ctx.campaign.id).reverse().sortBy('createdAt');
      if (!mems.length) return '还没有记忆。';
      return mems.slice(0, n).map((m) => `- ${m.when ? m.when + '：' : ''}${m.text}`).join('\n');
    },
  },
  {
    label: '看角色设定',
    spec: { name: 'character.read', description: '读在场角色的完整设定和示例对话。', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    async handler(input, ctx) {
      const name = str(input?.name, 50);
      const c = ctx.characters.find((x) => x.name === name) ?? ctx.characters[0];
      return c ? `## ${c.name}\n${c.full || c.core}` : '没有这个角色。';
    },
  },
  {
    label: '记下变化',
    spec: {
      name: 'state.update',
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
      name: 'overlay.write',
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

export function toolLabel(name: string): string {
  return kernelTools.find((t) => t.spec.name === name)?.label ?? name;
}

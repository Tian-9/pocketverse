import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext } from '$kernel/api';
import { ulid } from 'ulid';
import Diary from './Diary.svelte';

export interface DiaryEntry {
  id: string; campaignId: string; characterId: string;
  /** YYYY-MM-DD，真实日期 */
  date: string; text: string; createdAt: number;
  source: 'auto' | 'manual';
}

let ctx: PluginContext;
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const diaryApi = {
  entries: () => ctx.table<DiaryEntry>('entries'),
  async forDate(campaignId: string, date: string) {
    return this.entries().where('campaignId').equals(campaignId).filter((e) => e.date === date).first();
  },
  /** 让角色写某一天的日记：材料是那天的对话和最近的记忆 */
  async write(campaignId: string, characterId: string, date: string, source: DiaryEntry['source']) {
    if (!ctx.llm.configured) return null;
    const { db } = await import('$kernel/storage/db');
    const { textOf } = await import('$kernel/data/repo');
    const ch = await db().characters.get(characterId);
    const cp = await db().campaigns.get(campaignId);
    if (!ch || !cp) return null;
    const [y, m, d] = date.split('-').map(Number);
    const start = new Date(y!, m! - 1, d).getTime(), end = start + 86400_000;
    const convs = await db().conversations.where('campaignId').equals(campaignId).toArray();
    const msgs = (await Promise.all(convs.map((c) => db().messages.where('conversationId').equals(c.id).filter((x) => x.ts >= start && x.ts < end && x.role !== 'system').toArray()))).flat().sort((a, b) => a.ts - b.ts);
    const mems = await db().memories.where('campaignId').equals(campaignId).reverse().sortBy('createdAt');
    const prev = (await this.entries().where('campaignId').equals(campaignId).reverse().sortBy('date')).filter((e) => e.date < date)[0];
    const transcript = msgs.slice(-60).map((x) => `${x.role === 'user' ? '对方' : '我'}：${textOf(x)}`).join('\n');
    const { text } = await ctx.llm.chat({
      system: `你是「${ch.name}」。设定：${ch.core.slice(0, 800)}\n你在写自己的日记，第一人称，写给自己看，不是给别人看的。150 到 300 字。写今天真正在意的事和没说出口的想法，可以有情绪，可以不完整，不要总结式的流水账，不要带日期标题，不要提到"用户"这个词，称呼对方用你平时的叫法。只输出日记正文。`,
      user: `今天是 ${date}。${prev ? `\n昨天的日记（别重复）：\n${prev.text.slice(0, 300)}\n` : ''}\n今天的对话：\n${transcript || '（今天没有和对方说话）'}\n\n最近记得的事：\n${mems.slice(0, 6).map((x) => '- ' + x.text).join('\n') || '（无）'}\n现在的情绪：${cp.state.mood[characterId] ?? '平常'}`,
      maxTokens: 600, effort: 'low',
    });
    const body = text.trim();
    if (!body) return null;
    const entry: DiaryEntry = { id: ulid(), campaignId, characterId, date, text: body, createdAt: Date.now(), source };
    await this.entries().add(entry);
    ctx.emit('diary.written', { entryId: entry.id, characterId });
    return entry;
  },
};

export default definePlugin({
  id: 'diary',
  name: '日记',
  version: '0.3.0',
  description: '角色每天写一篇日记，他眼里的今天。角色能翻自己的日记，你也能看。',
  app: { screen: Diary, icon: { paths: icons.diary, background: gradients.pink } },
  storage: { tables: { entries: 'id, campaignId, characterId, date' } },
  promptContributors: [{
    id: 'last-diary',
    async volatile(p: PromptContext) {
      const last = (await ctx.table<DiaryEntry>('entries').where('campaignId').equals(p.campaignId).reverse().sortBy('date'))[0];
      if (!last) return '';
      return `<你最近一篇日记 ${last.date}>\n${last.text.slice(0, 400)}\n</你最近一篇日记>`;
    },
  }],
  tools: [{
    name: 'diary_read',
    label: '翻日记',
    description: '翻自己以前的日记。不给日期就列出最近几篇的日期和开头，给日期（YYYY-MM-DD）就读那一篇。',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
    async handler(input: unknown, p: PromptContext) {
      const date = String((input as { date?: unknown })?.date ?? '').trim();
      const all = await ctx.table<DiaryEntry>('entries').where('campaignId').equals(p.campaignId).reverse().sortBy('date');
      if (!all.length) return '还没写过日记。';
      if (!date) return all.slice(0, 10).map((e) => `- ${e.date}：${e.text.slice(0, 40).replace(/\n/g, ' ')}…`).join('\n');
      const e = all.find((x) => x.date === date);
      return e ? `${e.date}\n${e.text}` : '那天没写。';
    },
  }],
  onEvent: {
    /** 回来时补昨天的日记：离开超过 6 小时，且昨天有对话、还没写 */
    async 'app.resumed'({ elapsedMs }) {
      if (elapsedMs < 6 * 3600 * 1000) return;
      const { db } = await import('$kernel/storage/db');
      const y = new Date(); y.setDate(y.getDate() - 1);
      const date = today(y);
      let budget = 2;
      for (const c of await ctx.activeCampaigns()) {
        if (budget <= 0) break;
        if (await diaryApi.forDate(c.campaignId, date)) continue;
        const start = new Date(y.getFullYear(), y.getMonth(), y.getDate()).getTime();
        const convs = await db().conversations.where('campaignId').equals(c.campaignId).toArray();
        const talked = (await Promise.all(convs.map((cv) => db().messages.where('conversationId').equals(cv.id).filter((m) => m.ts >= start && m.ts < start + 86400_000).count()))).some((n) => n > 0);
        if (!talked) continue;
        budget--;
        const e = await diaryApi.write(c.campaignId, c.characterId, date, 'auto').catch((err) => { console.warn('[diary]', err); return null; });
        if (e) ctx.notify(`${c.characterName} 写了昨天的日记`, e.text.slice(0, 60), 'app');
      }
    },
  },
  setup(c) { ctx = c; },
});

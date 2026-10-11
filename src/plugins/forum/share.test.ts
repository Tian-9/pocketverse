import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin, { forumApi, type Thread } from './index';
import { findThread, validQuote, buildCard, postResolver } from './share';

const mk = (title: string): Thread => ({ id: title, campaignId: 'c', author: { kind: 'npc', name: 'n' }, title, body: 'b', createdAt: 0, lastReplyAt: 0, replyCount: 0, source: 'crowd' });

beforeAll(async () => {
  openDB([plugin]);
  const kv = new Map<string, unknown>();
  await plugin.setup!({
    id: 'forum', emit() {}, navigate() {}, back() {}, notify() {},
    settings: { async get(k: string, f: unknown) { return kv.has(k) ? kv.get(k) : f; }, async set(k: string, v: unknown) { kv.set(k, v); } },
    table: (name: string) => db().table(pluginTable('forum', name)),
    llm: { configured: false, async chat() { return { text: '' }; } },
    data: { async character() { return { id: 'ch1', name: '阿一', core: '' }; }, async campaign() { return undefined; } },
  } as unknown as PluginContext);
});

describe('forum share', () => {
  it('findThread: exact beats partial, ignores brackets and spaces', () => {
    const ts = [mk('面包涨价了'), mk('面包'), mk('黑猫')];
    expect(findThread(ts, '《面包》')!.id).toBe('面包');
    expect(findThread(ts, '面包涨价')!.id).toBe('面包涨价了');
    expect(findThread(ts, '黑 猫')!.id).toBe('黑猫');
    expect(findThread(ts, '狗')).toBeUndefined();
    expect(findThread(ts, '')).toBeUndefined();
  });

  it('validQuote only accepts sentences from the body or a reply', () => {
    const t = { ...mk('x'), body: '今晚月亮很圆，想出去走走' };
    const r = { id: 'r', threadId: 'x', campaignId: 'c', author: { kind: 'npc' as const, name: 'n' }, body: '我也是', createdAt: 0 };
    expect(validQuote('月亮很圆', t, [r])).toBe('月亮很圆');
    expect(validQuote('我也是', t, [r])).toBe('我也是');
    expect(validQuote('编的', t, [r])).toBeUndefined();
    expect(validQuote('', t, [r])).toBeUndefined();
  });

  it('card opens the thread screen and carries author and reply count', () => {
    const c = buildCard({ ...mk('标题'), replyCount: 3 }, '老王', '引');
    expect(c).toMatchObject({ type: 'post', title: '标题', subtitle: '老王 · 3 回复', quote: '引', open: { pluginId: 'forum', screen: 'thread', params: { id: '标题' } } });
  });

  it('resolver finds the thread in this save, validates quote, and refuses to invent', async () => {
    const t = await forumApi.post('cpS', { kind: 'char', characterId: 'ch1' }, '今天好累', '不想说话，想睡', 'chat');
    await forumApi.reply(t, { kind: 'npc', name: '路人' }, '早点休息');
    const ctx = { campaignId: 'cpS', characterIds: ['ch1'] };
    const r = await postResolver.resolve({ type: 'post', title: '今天好累', quote: '早点休息' }, ctx);
    expect(r.card.quote).toBe('早点休息');
    expect(r.card.subtitle).toBe('阿一 · 1 回复');
    expect(r.forModel).toContain('不想说话');
    const r2 = await postResolver.resolve({ type: 'post', title: '今天好累', quote: '瞎编' }, ctx);
    expect(r2.card.quote).toBeUndefined();
    expect(r2.forModel).toContain('已去掉');
    await expect(postResolver.resolve({ type: 'post', title: '不存在' }, ctx)).rejects.toThrow('不要编');
    await expect(postResolver.resolve({ type: 'post', title: '今天好累' }, { campaignId: 'other', characterIds: [] })).rejects.toThrow();
  });
});

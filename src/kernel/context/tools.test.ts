import { describe, it, expect, vi, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import { kernelTools, shareTool } from './tools';

vi.mock('../catchup/catchup', () => ({ catchup: { armWake: vi.fn(async () => {}), hasAttach: () => false } }));
beforeAll(() => { openDB([]); });

describe('kernel tools', () => {
  it('all tool names satisfy the API pattern', () => {
    for (const t of kernelTools) expect(t.spec.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
  });
});

describe('share tool', () => {
  const ctx = { campaign: {} as any, characters: [{ name: '林晚秋' }] as any, lore: [], overlays: [], cards: [] as any[], attached: [] as any[] };
  const resolver = { type: 'music', label: '歌', hint: 'music：歌', resolve: async (q: any) => ({ card: { type: 'music', title: q.title, quote: q.quote }, forModel: `找到了 ${q.title}，{{char}} 可以引` }) };

  it('is absent without resolvers and lists resolver types as the enum', async () => {
    expect(shareTool([])).toBeNull();
    const t = shareTool([resolver])!;
    expect(t.spec.name).toBe('share');
    expect((t.spec.inputSchema as any).properties.type.enum).toEqual(['music']);
    expect(t.spec.description).toContain('music：歌');
  });

  it('dispatches by type, collects the card and expands macros in the text for the model', async () => {
    const t = shareTool([resolver])!;
    const out = await t.handler({ type: 'music', title: '晴天', quote: '  x ' }, ctx as any);
    expect(out).toBe('找到了 晴天，林晚秋 可以引');
    expect(ctx.cards).toEqual([{ type: 'music', title: '晴天', quote: 'x' }]);
    expect(await t.handler({ type: 'movie', title: 'x' }, ctx as any)).toContain('没有「movie」');
    expect(await t.handler({ type: 'music', title: ' ' }, ctx as any)).toContain('title 不能为空');
  });
});

describe('handle_attached tool', () => {
  it('applies the matching task once and rejects unknown keys', async () => {
    const { attachedTool, attachedPrompt } = await import('./tools');
    const applied: unknown[] = [];
    const task = { key: 'moments_replies', ctx: { campaignId: 'cp' } as any, item: { label: '朋友圈评论', prompt: '对方评论了', schema: { type: 'object' }, apply: async (o: unknown) => { applied.push(o); } } };
    const ctx = { campaign: {} as any, characters: [] as any, lore: [], overlays: [], cards: [], attached: [task] };
    expect(attachedPrompt([task])).toContain('key：moments_replies');
    expect(await attachedTool.handler({ key: 'moments_replies', output: { replies: [] } }, ctx as any)).toBe('朋友圈评论 已处理。');
    expect(applied).toEqual([{ replies: [] }]);
    expect(await attachedTool.handler({ key: 'moments_replies', output: {} }, ctx as any)).toContain('没有 key');
    expect(attachedPrompt([])).toBe('');
  });
});

describe('wake_later tool', () => {
  it('clamps minutes, requires an intent, stores one wake per campaign and re-arms the timer', async () => {
    const { wakes, MIN_MINUTES, MAX_MINUTES } = await import('../catchup/wake');
    const { catchup } = await import('../catchup/catchup');
    const t = kernelTools.find((x) => x.spec.name === 'wake_later')!;
    const ctx = { campaign: { id: 'cp9' } as any, characters: [{ id: 'c9', name: '阿九' }] as any, lore: [], overlays: [], cards: [] as any[], attached: [] as any[] };
    expect(await t.handler({ afterMinutes: 10, intent: '  ' }, ctx as any)).toContain('intent 不能为空');
    expect(await wakes.get('cp9')).toBeNull();
    const before = Date.now();
    expect(await t.handler({ afterMinutes: 1, intent: '提醒吃药' }, ctx as any)).toContain(`${MIN_MINUTES} 分钟后`);
    const w = (await wakes.get('cp9'))!;
    expect(w).toMatchObject({ campaignId: 'cp9', characterId: 'c9', intent: '提醒吃药', onlyIfSilent: false });
    expect(w.fireAt - w.createdAt).toBe(MIN_MINUTES * 60_000);
    expect(w.createdAt).toBeGreaterThanOrEqual(before);
    expect(await t.handler({ afterMinutes: 99999999, intent: '下班说', onlyIfSilent: true }, ctx as any)).toContain('没回就');
    const w2 = (await wakes.get('cp9'))!;
    expect(w2.fireAt - w2.createdAt).toBe(MAX_MINUTES * 60_000);
    expect(w2.onlyIfSilent).toBe(true);
    expect((await db().kv.where('key').startsWith('kernel.wake.').count())).toBe(1);
    expect(catchup.armWake).toHaveBeenCalled();
  });
});

describe('state_update tool', () => {
  it('moves the campaign clock forward by advance minutes, capped at a day, never backwards', async () => {
    const { clock, MAX_ADVANCE_MINUTES } = await import('./clock');
    const t = kernelTools.find((x) => x.spec.name === 'state_update')!;
    await db().campaigns.put({ id: 'cp-adv', worldId: 'w', characterIds: ['c1'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } });
    const campaign = (await db().campaigns.get('cp-adv'))!;
    const ctx = { campaign, characters: [{ id: 'c1', name: '阿一' }] as any, lore: [], overlays: [], cards: [] as any[], attached: [] as any[] };
    const before = Date.now();
    expect(await t.handler({ mood: '困', advance: 90 }, ctx as any)).toContain('时间来到');
    const c1 = (await db().campaigns.get('cp-adv'))!;
    expect(c1.state.mood.c1).toBe('困');
    expect(clock.now(c1.clock) - Date.now()).toBeGreaterThan(89 * 60_000 - (Date.now() - before));
    expect(await t.handler({ advance: -500 }, ctx as any)).toBe('已更新状态。');
    expect((await db().campaigns.get('cp-adv'))!.clock).toEqual(c1.clock);
    await t.handler({ advance: 10 * MAX_ADVANCE_MINUTES }, ctx as any);
    const c2 = (await db().campaigns.get('cp-adv'))!;
    expect(clock.now(c2.clock) - clock.now(c1.clock)).toBeLessThanOrEqual(MAX_ADVANCE_MINUTES * 60_000 + 1000);
  });
});

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import type { CatchupItem } from '../api/types';

vi.mock('../llm/gateway.svelte', () => ({ llm: { configured: true, chat: vi.fn(), settings: {} } }));
vi.mock('../registry/registry.svelte', () => ({ registry: { plugins: [] as unknown[], isEnabled: () => true } }));
vi.mock('../nav/nav.svelte', () => ({ nav: { push: vi.fn() } }));

beforeAll(() => { openDB([]); });
const H = 3600_000;

describe('catchup tiers', () => {
  it('maps elapsed time to tiers and higher tiers cover lower ones', async () => {
    const { tierFor, covers, elapsedText } = await import('./catchup');
    expect(tierFor(5 * H)).toBeNull();
    expect(tierFor(6 * H)).toBe('h6');
    expect(tierFor(30 * H)).toBe('d1');
    expect(tierFor(49 * H)).toBe('days');
    expect(covers('h6', 'd1')).toBe(false);
    expect(covers('days', 'h6')).toBe(true);
    expect(covers('h6', 'attach')).toBe(true);
    expect(elapsedText(8 * H)).toBe('大约 8 小时');
    expect(elapsedText(3 * 24 * H + 5 * H)).toBe('3 天');
  });
});

describe('catchup run', () => {
  it('batches all contributors of one character into one call, dispatches results, and respects per-character elapsed time', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { registry } = await import('../registry/registry.svelte');
    const { catchup } = await import('./catchup');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    const now = 1_000_000_000_000;
    await db().characters.bulkAdd([{ id: 'a', name: 'A', core: 'x', full: '' }, { id: 'b', name: 'B', core: 'y', full: '' }]);
    await db().campaigns.bulkAdd([
      { id: 'ca', worldId: 'w', characterIds: ['a'], name: 'a', createdAt: 0, lastPlayedAt: now - 1 * H, state: { relations: {}, mood: {}, facts: [] } },
      { id: 'cb', worldId: 'w', characterIds: ['b'], name: 'b', createdAt: 0, lastPlayedAt: now - 3 * 24 * H, state: { relations: {}, mood: { b: '无聊' }, facts: [] } },
    ]);
    const applied: Record<string, unknown> = {};
    const item = (label: string): CatchupItem => ({ label, prompt: `做 ${label}`, schema: { type: 'object', properties: { text: { type: 'string' } } }, apply: async (o) => { applied[label] = o; } });
    const collectDay = vi.fn(async (_c: unknown) => item('日记'));
    (registry.plugins as unknown[]).push(
      { id: 'moments', catchup: [{ id: 'post', tier: 'h6', collect: async () => item('朋友圈') }, { id: 'replies', tier: 'attach', collect: async () => item('回评') }] },
      { id: 'diary', catchup: [{ id: 'write', tier: 'd1', collect: collectDay }, { id: 'nothing', tier: 'h6', collect: async () => null }] },
    );
    chat.mockResolvedValueOnce({ text: JSON.stringify({ moments_post: { text: '发了' }, moments_replies: { text: '回了' }, diary_write: { text: '写了' } }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.run(now);

    // 只有 B 达到档位（3 天），A 一小时前刚聊过
    expect(chat).toHaveBeenCalledTimes(1);
    const req = chat.mock.calls[0]![0];
    expect(req.purpose).toBe('catchup');
    expect(req.system[0].text).toContain('「B」');
    expect(req.messages[0].content[0].text).toContain('对方离开了3 天');
    expect(req.messages[0].content[0].text).toContain('## 朋友圈（字段 moments_post）');
    expect(req.jsonSchema.required).toEqual(['moments_post', 'moments_replies', 'diary_write']);
    expect(collectDay.mock.calls[0]![0]).toMatchObject({ campaignId: 'cb', characterName: 'B', tier: 'days', days: 3 });
    expect(applied).toEqual({ 朋友圈: { text: '发了' }, 回评: { text: '回了' }, 日记: { text: '写了' } });
    expect((await db().campaigns.get('cb'))!.catchupAt).toBe(now);
    expect((await db().campaigns.get('ca'))!.catchupAt).toBeUndefined();

    // 再回来一小时后：B 的间隔从上次补发算，不够 6 小时，不再触发
    await catchup.run(now + 1 * H);
    expect(chat).toHaveBeenCalledTimes(1);
    // 7 小时后：A（8 小时没聊）和 B（上次补发后 7 小时）都到 h6 档，各一次调用，只带 h6 和 attach 的，不带 d1 的日记
    chat.mockResolvedValue({ text: JSON.stringify({ moments_post: { text: '' }, moments_replies: { text: '' } }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.run(now + 7 * H);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls.slice(1).map((c) => c[0].system[0].text.match(/「(.)」/)![1]).sort()).toEqual(['A', 'B']);
    for (const c of chat.mock.calls.slice(1)) expect(c[0].jsonSchema.required).toEqual(['moments_post', 'moments_replies']);
  });
});

describe('wake_later (稍后联系)', () => {
  it('fires a due wake through the same per-character call even below any tier, writes the messages, and clears it', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { registry } = await import('../registry/registry.svelte');
    const { catchup } = await import('./catchup');
    const { wakes } = await import('./wake');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    chat.mockReset();
    (registry.plugins as unknown[]).length = 0;
    (registry.plugins as unknown[]).push({ id: 'moments', catchup: [
      { id: 'post', tier: 'h6', collect: async () => ({ label: '朋友圈', prompt: 'x', schema: { type: 'object' }, apply: async () => {} }) },
      { id: 'replies', tier: 'attach', collect: async () => ({ label: '回评', prompt: 'y', schema: { type: 'object' }, apply: async () => {} }) },
    ] });
    const now = 2_000_000_000_000;
    await db().campaigns.clear(); await db().characters.clear(); await db().kv.clear();
    await db().characters.add({ id: 'w', name: 'W', core: 'z', full: '', timeZone: 'Asia/Tokyo' });
    await db().campaigns.add({ id: 'cw', worldId: 'w', characterIds: ['w'], name: 'w', createdAt: 0, lastPlayedAt: now - 20 * 60_000, userPersona: '隔壁班的', state: { relations: {}, mood: {}, facts: [] } });
    await db().setKV('kernel.currentCampaign.w', 'cw');
    await wakes.set({ campaignId: 'cw', characterId: 'w', fireAt: now - 1000, intent: '提醒他吃药', createdAt: now - 30 * 60_000 });

    chat.mockResolvedValueOnce({ text: JSON.stringify({ kernel_wake: { send: true, messages: ['吃药了没', '别又忘了'] }, moments_replies: {} }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.run(now);
    expect(chat).toHaveBeenCalledTimes(1);
    const req = chat.mock.calls[0]![0];
    // 没到档：只带稍后联系 + 依附档，不带 h6 的朋友圈
    expect(req.jsonSchema.required).toEqual(['kernel_wake', 'moments_replies']);
    const u = req.messages[0].content[0].text as string;
    expect(u).toContain('提醒他吃药');
    expect(u).toContain('你在 Asia/Tokyo');
    expect(req.system[0].text).toContain('隔壁班的');
    expect(req.system[0].text).toContain('到时间了');
    const conv = await db().conversations.where('campaignId').equals('cw').first();
    const msgs = await db().messages.where('conversationId').equals(conv!.id).sortBy('ts');
    expect(msgs.map((m) => (m.content[0] as { text: string }).text)).toEqual(['吃药了没', '别又忘了']);
    expect(msgs.every((m) => m.meta?.wake === true)).toBe(true);
    expect(await wakes.get('cw')).toBeNull();
  });

  it('drops an onlyIfSilent wake when the user has written since, and ignores wakes that are not due', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { catchup } = await import('./catchup');
    const { wakes } = await import('./wake');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    chat.mockReset();
    const now = 2_000_000_000_000;
    const conv = await db().conversations.where('campaignId').equals('cw').first();
    await db().messages.add({ id: 'u1', conversationId: conv!.id, role: 'user', content: [{ type: 'text', text: '吃了' }], ts: now + 60_000 });
    await db().campaigns.update('cw', { lastPlayedAt: now + 60_000, catchupAt: now });
    await wakes.set({ campaignId: 'cw', characterId: 'w', fireAt: now + 2 * 60_000, intent: '追一句', createdAt: now, onlyIfSilent: true });
    await catchup.run(now + 90_000); // 没到点
    expect(chat).not.toHaveBeenCalled();
    expect(await wakes.get('cw')).not.toBeNull();
    await catchup.run(now + 3 * 60_000); // 到点了，但对方已经回了
    expect(chat).not.toHaveBeenCalled();
    expect(await wakes.get('cw')).toBeNull();
  });
});

describe('catchup on the story clock', () => {
  const D = 24 * H;
  async function reset() {
    const { llm } = await import('../llm/gateway.svelte');
    const { registry } = await import('../registry/registry.svelte');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    chat.mockReset();
    (registry.plugins as unknown[]).length = 0;
    const seen: unknown[] = [];
    (registry.plugins as unknown[]).push({ id: 'moments', catchup: [
      { id: 'post', tier: 'h6', collect: async (c: unknown) => { seen.push(c); return { label: '朋友圈', prompt: 'x', schema: { type: 'object' }, apply: async () => {} }; } },
    ] });
    await db().campaigns.clear(); await db().characters.clear(); await db().kv.clear(); await db().conversations.clear(); await db().messages.clear();
    await db().characters.add({ id: 's', name: 'S', core: 'z', full: '' });
    await db().setKV('kernel.currentCampaign.s', 'cs');
    return { chat, seen };
  }

  it('a paused save does not catch up however long you are away; skipping time does, once', async () => {
    const { chat, seen } = await reset();
    const { catchup } = await import('./catchup');
    const now = 3_000_000_000_000;
    const story = now - 365 * D;
    // 停表：剧情定在一年前，三天没来
    await db().campaigns.add({ id: 'cs', worldId: 'w', characterIds: ['s'], name: 's', createdAt: 0, lastPlayedAt: now - 3 * D, playedStoryTs: story, clock: { anchorStoryTs: story, anchorRealTs: now - 3 * D, running: false }, state: { relations: {}, mood: {}, facts: [] } });
    await catchup.run(now);
    expect(chat).not.toHaveBeenCalled();
    // 在聊天里跳了三天：days 档，材料说「过去了3 天」，时间行标剧情时间，收集到的上下文带 from/to/skipped
    chat.mockResolvedValueOnce({ text: JSON.stringify({ moments_post: {} }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.skipped('cs', story, story + 3 * D, now);
    expect(chat).toHaveBeenCalledTimes(1);
    const u = chat.mock.calls[0]![0].messages[0].content[0].text as string;
    expect(u).toContain('过去了3 天');
    expect(u).toContain('（剧情时间）');
    expect(seen[0]).toMatchObject({ tier: 'days', days: 3, from: story, to: story + 3 * D, now: story + 3 * D, skipped: true });
    const cp = (await db().campaigns.get('cs'))!;
    expect(cp.catchupStoryTs).toBe(story + 3 * D);
    expect(cp.catchupAt).toBe(now);
    // 再查一次：这段已经算过了，不重复
    await db().campaigns.update('cs', { clock: { anchorStoryTs: story + 3 * D, anchorRealTs: now, running: false } });
    await catchup.run(now + 2 * D);
    expect(chat).toHaveBeenCalledTimes(1);
    // 跳一小段（没到档）也记下来
    await catchup.skipped('cs', story + 3 * D, story + 3 * D + H, now + 2 * D);
    expect(chat).toHaveBeenCalledTimes(1);
    expect((await db().campaigns.get('cs'))!.catchupStoryTs).toBe(story + 3 * D + H);
  });

  it('a running save with an offset behaves like real time: elapsed is real elapsed', async () => {
    const { chat } = await reset();
    const { catchup } = await import('./catchup');
    const now = 3_000_000_000_000;
    const played = now - 8 * H;
    await db().campaigns.add({ id: 'cs', worldId: 'w', characterIds: ['s'], name: 's', createdAt: 0, lastPlayedAt: played, playedStoryTs: played - 30 * D, clock: { anchorStoryTs: played - 30 * D, anchorRealTs: played, running: true }, state: { relations: {}, mood: {}, facts: [] } });
    chat.mockResolvedValueOnce({ text: JSON.stringify({ moments_post: {} }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.run(now);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0]![0].messages[0].content[0].text).toContain('对方离开了大约 8 小时');
  });

  it("a wake on a paused clock fires when the user skips past it, not as real time passes", async () => {
    const { chat } = await reset();
    const { catchup } = await import('./catchup');
    const { wakes } = await import('./wake');
    const now = 3_000_000_000_000;
    const story = now - 100 * D;
    await db().campaigns.add({ id: 'cs', worldId: 'w', characterIds: ['s'], name: 's', createdAt: 0, lastPlayedAt: now, playedStoryTs: story, clock: { anchorStoryTs: story, anchorRealTs: now, running: false }, state: { relations: {}, mood: {}, facts: [] } });
    await wakes.set({ campaignId: 'cs', characterId: 's', fireAt: story + 2 * H, intent: '下班说', createdAt: now, createdStoryTs: story });
    await catchup.run(now + 5 * H); // 真实过了五小时，剧情没动
    expect(chat).not.toHaveBeenCalled();
    expect(await wakes.get('cs')).not.toBeNull();
    chat.mockResolvedValueOnce({ text: JSON.stringify({ kernel_wake: { send: true, messages: ['下班啦'] } }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.skipped('cs', story, story + 3 * H, now + 5 * H);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0]![0].messages[0].content[0].text).toContain('3 小时前你记下');
    expect(await wakes.get('cs')).toBeNull();
    const conv = await db().conversations.where('campaignId').equals('cs').first();
    const msgs = await db().messages.where('conversationId').equals(conv!.id).toArray();
    expect(msgs.map((m) => (m.content[0] as { text: string }).text)).toEqual(['下班啦']);
    expect(msgs[0]!.storyTs).toBeDefined();
  });
});

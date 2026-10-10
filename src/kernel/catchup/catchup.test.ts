import { describe, it, expect, vi, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import type { CatchupItem } from '../api/types';

vi.mock('../llm/gateway.svelte', () => ({ llm: { configured: true, chat: vi.fn(), settings: {} } }));
vi.mock('../registry/registry.svelte', () => ({ registry: { plugins: [] as unknown[], isEnabled: () => true } }));

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

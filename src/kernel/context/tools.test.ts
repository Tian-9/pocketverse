import { describe, it, expect } from 'vitest';
import { kernelTools, shareTool } from './tools';

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

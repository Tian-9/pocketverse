// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PromptContext } from '$kernel/api';
import plugin, { drawTool } from './index';

const cards: { tag: string; body: string; alt?: string }[] = [];
const pc: PromptContext = { campaignId: 'cp1', conversationId: 'cv1', characterIds: ['ch1'], addCard: (tag: string, body: string, _a?: Record<string, string>, alt?: string) => cards.push({ tag, body, alt }) } as unknown as PromptContext;

describe('draw tool', () => {
  it('sanitizes and puts a drawing share card with a data-url cover', async () => {
    const r = await drawTool.handler({ title: '一只猫', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#fc6"/><script>x()</script></svg>' }, pc);
    expect(r).toContain('画好了');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.tag).toBe('share'); expect(cards[0]!.alt).toBe('[画了一张画：一只猫]');
    const card = JSON.parse(cards[0]!.body);
    expect(card.type).toBe('drawing'); expect(card.title).toBe('一只猫');
    expect(card.cover.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(card.cover)).not.toContain('script');
  });

  it('rejects bad svg without a card and tells him to redraw', async () => {
    const before = cards.length;
    const r = await drawTool.handler({ title: 'x', svg: 'not svg' }, pc);
    expect(r).toContain('不合法');
    expect(cards.length).toBe(before);
    expect(plugin.tools![0]!.name).toBe('draw');
  });
});

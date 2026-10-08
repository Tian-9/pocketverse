import { describe, it, expect } from 'vitest';
import { triggerL1 } from './l1';
import type { LoreEntry, LoreOverlay } from '../storage/db';

const e = (id: string, keywords: string[], content: string, extra: Partial<LoreEntry> = {}): LoreEntry => ({
  id, worldId: 'w', title: id, summary: '', content, scope: 'world', triggers: { keywords }, constant: false, order: 0, enabled: true, ...extra,
});

describe('triggerL1', () => {
  it('matches keywords case-insensitively and respects enabled', () => {
    const r = triggerL1([e('a', ['邮差'], 'A'), e('b', ['Library'], 'B'), e('c', ['邮差'], 'C', { enabled: false })], [], { scanText: '那个邮差去了 library' });
    expect(r.map((x) => x.entry.id)).toEqual(['a', 'b']);
  });
  it('recurses through recursive entries up to depth and sorts by order', () => {
    const r = triggerL1([
      e('a', ['邮差'], '邮差住在钟楼', { triggers: { keywords: ['邮差'], recursive: true }, order: 2 }),
      e('b', ['钟楼'], '钟楼有地下室', { order: 1 }),
    ], [], { scanText: '邮差' });
    expect(r.map((x) => x.entry.id)).toEqual(['b', 'a']);
  });
  it('prefers overlay content and enforces token budget', () => {
    const ov: LoreOverlay = { id: 'o', campaignId: 'c', loreEntryId: 'a', title: '', summary: '', content: '钟楼塌了', reason: '', createdAt: 0 };
    const r = triggerL1([e('a', ['钟楼'], '钟楼矗立'), e('big', ['钟楼'], '字'.repeat(5000), { order: 1 })], [ov], { scanText: '钟楼', budgetTokens: 100 });
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toBe('钟楼塌了');
    expect(r[0]!.overlaid).toBe(true);
  });
});

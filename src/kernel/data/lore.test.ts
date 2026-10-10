import { describe, it, expect } from 'vitest';
import { loreApplies } from './lore';
import type { LoreEntry } from '../storage/db';

const entry = (p: Partial<LoreEntry>): LoreEntry => ({ id: 'x', worldId: 'w1', title: '', summary: '', content: '', scope: 'world', triggers: { keywords: [] }, constant: false, order: 0, enabled: true, ...p });

describe('loreApplies', () => {
  it('world entries follow the campaign world, character entries follow the card, style is global', () => {
    const w1 = entry({ id: 'w1e', worldId: 'w1' });
    const w2 = entry({ id: 'w2e', worldId: 'w2' });
    const bg = entry({ id: 'bg', worldId: 'character', scope: 'character', characterIds: ['c'] });
    const other = entry({ id: 'bg2', worldId: 'character', scope: 'character', characterIds: ['d'] });
    const style = entry({ id: 's', worldId: 'global', kind: 'style' });
    const pick = (worldId: string) => [w1, w2, bg, other, style].filter((e) => loreApplies(e, worldId, ['c'])).map((e) => e.id);
    expect(pick('w1')).toEqual(['w1e', 'bg', 's']);
    expect(pick('w2')).toEqual(['w2e', 'bg', 's']);
  });
  it('old character entries that still carry a world id keep following the card', () => {
    const legacy = entry({ id: 'l', worldId: 'w1', scope: 'character', characterIds: ['c'] });
    expect(loreApplies(legacy, 'w2', ['c'])).toBe(true);
  });
});

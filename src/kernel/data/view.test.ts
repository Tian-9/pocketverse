import { describe, it, expect, beforeAll } from 'vitest';
import { ulid } from 'ulid';
import { openDB, db } from '../storage/db';
import { repo } from './repo';
import { dataView } from './view';

beforeAll(() => { openDB([]); });

describe('dataView', () => {
  it('currentCampaigns lists one save per card, the current one, newest first, with world and character names', async () => {
    const a = await repo.createCharacter({ name: '阿一', core: 'a', full: 'a' });
    const b = await repo.createCharacter({ name: '阿二', core: 'b', full: 'b' });
    const first = await repo.campaignFor(a);
    const other = await repo.createWorld('霍格沃茨', '魔法学校');
    const second = await repo.newCampaign(a, other.id);
    const bCamp = await repo.campaignFor(b);
    await db().campaigns.update(bCamp.id, { lastPlayedAt: Date.now() + 1000 });

    const views = await dataView.currentCampaigns();
    expect(views.map((v) => v.id)).toEqual([bCamp.id, second.id]);
    expect(views.map((v) => v.id)).not.toContain(first.id);
    const v = views.find((x) => x.id === second.id)!;
    expect(v.worldName).toBe('霍格沃茨');
    expect(v.characterName).toBe('阿一');
    expect(v.characterId).toBe(a.id);
  });

  it('views are snapshots: mutating one does not write back', async () => {
    const c = await repo.createCharacter({ name: '阿三', core: 'c', full: 'c' });
    const cp = await repo.campaignFor(c);
    const v = (await dataView.campaign(cp.id))!;
    v.state.facts.push('改了');
    expect((await db().campaigns.get(cp.id))!.state.facts).toEqual([]);
  });

  it('memories are newest first and filter by importance', async () => {
    const c = await repo.createCharacter({ name: '阿四', core: 'd', full: 'd' });
    const cp = await repo.campaignFor(c);
    for (const [i, imp] of [1, 3, 2].entries()) {
      await db().memories.add({ id: ulid(), campaignId: cp.id, when: '', text: `m${i}`, importance: imp as 1 | 2 | 3, sourceMessageIds: [], createdAt: 1000 + i });
    }
    expect((await dataView.memories(cp.id)).map((m) => m.text)).toEqual(['m2', 'm1', 'm0']);
    expect((await dataView.memories(cp.id, { minImportance: 2, limit: 1 })).map((m) => m.text)).toEqual(['m2']);
  });

  it('loreDirectory follows the save: its world entries plus the card background, overlay wins, style excluded', async () => {
    const c = await repo.createCharacter({ name: '阿五', core: 'e', full: 'e' });
    const cp = await repo.campaignFor(c);
    const base = { content: '', triggers: { keywords: [] as string[] }, constant: false, order: 0, enabled: true };
    await db().lore.bulkAdd([
      { ...base, id: 'w1', worldId: cp.worldId, scope: 'world', title: '王都', summary: '繁华' },
      { ...base, id: 'w2', worldId: 'elsewhere', scope: 'world', title: '别处', summary: '不该出现' },
      { ...base, id: 'c1', worldId: 'character', scope: 'character', characterIds: [c.id], title: '身世', summary: '孤儿' },
      { ...base, id: 's1', worldId: 'global', scope: 'world', kind: 'style', title: '口吻', summary: '不该出现' },
    ]);
    await db().overlays.add({ id: 'o1', campaignId: cp.id, loreEntryId: 'w1', title: '王都', summary: '被烧了', content: '', reason: '', createdAt: 1 });
    const dir = await dataView.loreDirectory(cp.id);
    expect(dir).toContain('王都：被烧了（本局已变化，原为：繁华）');
    expect(dir).toContain('身世：孤儿');
    expect(dir).not.toContain('不该出现');
    expect(await dataView.loreDirectory('nope')).toBe('');
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import type { PluginContext } from '$kernel/api';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import plugin from './index';
import { backup, snapshotOf, sameData, versionsTable, deleteVersionsOf, KEEP } from './versions';

beforeAll(async () => {
  openDB([plugin]);
  await plugin.setup!({ id: 'characters', table: (name: string) => db().table(pluginTable('characters', name)) } as unknown as PluginContext);
});

const ch = { id: 'c1', name: '阿一', core: '一个人', full: '', useFirstMessage: false, timeMode: 'real' as const };

describe('character versions', () => {
  it('snapshots only card text and treats defaults as equal', () => {
    expect(snapshotOf({ ...ch, avatar: new Blob(['x']) })).toEqual({ name: '阿一', core: '一个人', full: '', timeMode: 'real' });
    expect(sameData(snapshotOf(ch), { name: '阿一', core: '一个人', full: '' })).toBe(true);
    expect(sameData(snapshotOf(ch), { name: '阿一', core: '另一个人', full: '' })).toBe(false);
  });

  it('keeps a version before an edit, skips duplicates, caps at KEEP and deletes with the character', async () => {
    expect(await backup(ch, '编辑前')).toBe(true);
    expect(await backup(ch, '编辑前')).toBe(false);
    for (let i = 0; i < KEEP + 5; i++) expect(await backup({ ...ch, core: `v${i}` }, '编辑前')).toBe(true);
    const all = await versionsTable().where('characterId').equals('c1').sortBy('createdAt');
    expect(all.length).toBe(KEEP);
    expect(all[all.length - 1]!.data.core).toBe(`v${KEEP + 4}`);
    await deleteVersionsOf('c1');
    expect(await versionsTable().where('characterId').equals('c1').count()).toBe(0);
  });
});

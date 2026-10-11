import { describe, it, expect } from 'vitest';
import { PocketDB, pluginTable } from './db';

describe('PocketDB', () => {
  it('creates kernel tables and prefixed plugin tables', async () => {
    const db = new PocketDB('test-' + Math.random(), [
      { id: 'my-plugin', name: 'x', version: '0', storage: { tables: { notes: 'id, ts' } } },
    ]);
    await db.open();
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('kv');
    expect(names).toContain(pluginTable('my-plugin', 'notes'));
    await db.setKV('a', { b: 1 });
    expect(await db.getKV('a', null)).toEqual({ b: 1 });
    expect(await db.getKV('missing', 'dflt')).toBe('dflt');
  });
});

describe('PocketDB v6 upgrade', () => {
  it('moves the old free-text story time into facts', async () => {
    const Dexie = (await import('dexie')).default;
    const name = 'test-up-' + Math.random();
    const old = new Dexie(name);
    old.version(500).stores({ worlds: 'id', lore: 'id', characters: 'id', campaigns: 'id, worldId, lastPlayedAt', conversations: 'id', messages: 'id', memories: 'id', overlays: 'id', kv: 'key', usage: 'id', memfs: '[campaignId+path]', logs: 'id' });
    await old.open();
    await old.table('campaigns').put({ id: 'a', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { inWorldTime: '三天后的早上', relations: {}, mood: {}, facts: ['下雨'] } });
    await old.table('campaigns').put({ id: 'b', worldId: 'w', characterIds: ['c'], name: 'y', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } });
    old.close();
    const db = new PocketDB(name, []);
    await db.open();
    const a = (await db.campaigns.get('a'))!;
    expect((a.state as Record<string, unknown>).inWorldTime).toBeUndefined();
    expect(a.state.facts).toEqual(['之前记的剧情时间：三天后的早上', '下雨']);
    expect((await db.campaigns.get('b'))!.state.facts).toEqual([]);
    db.close();
  });
});

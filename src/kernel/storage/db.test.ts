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

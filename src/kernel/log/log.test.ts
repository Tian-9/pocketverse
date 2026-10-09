import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db } from '../storage/db';
import { log, fmt } from './log';

beforeAll(() => { openDB([]); });

describe('log', () => {
  it('persists entries with truncated data and dumps oldest first', async () => {
    log.info('t', '一', { long: 'x'.repeat(400), skip: undefined, n: 1 });
    log.warn('t', '二');
    await new Promise((r) => setTimeout(r, 50));
    const rows = await log.recent();
    expect(rows.map((r) => r.message)).toEqual(['二', '一']);
    expect((rows[1]!.data as { long: string }).long).toHaveLength(301);
    expect('skip' in (rows[1]!.data as object)).toBe(false);
    const text = await log.dump();
    expect(text.split('\n')[0]).toContain('[t] 一');
    expect(fmt(rows[0]!)).toContain('WARN  [t] 二');
  });
  it('trims to the cap', async () => {
    await db().logs.bulkAdd(Array.from({ length: 1100 }, (_, i) => ({ id: 'k' + String(i).padStart(5, '0'), ts: i, level: 'info' as const, tag: 'x', message: String(i) })));
    await log.trim();
    expect(await db().logs.count()).toBe(1000);
    expect(await db().logs.get('k00000')).toBeUndefined();
  });
});

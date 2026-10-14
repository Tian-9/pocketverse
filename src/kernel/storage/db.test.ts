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
    expect((a.state as unknown as Record<string, unknown>).inWorldTime).toBeUndefined();
    expect(a.state.facts).toEqual(['之前记的剧情时间：三天后的早上', '下雨']);
    expect((await db.campaigns.get('b'))!.state.facts).toEqual([]);
    db.close();
  });
});

describe('PocketDB v8 upgrade', () => {
  it('stores 用户 and the global name as {{user}} in memories, state, events and overlays', async () => {
    const Dexie = (await import('dexie')).default;
    const name = 'test-v8-' + Math.random();
    const old = new Dexie(name);
    old.version(700).stores({ worlds: 'id', lore: 'id', characters: 'id', campaigns: 'id, worldId, lastPlayedAt', conversations: 'id', messages: 'id', memories: 'id', events: 'id, scope, [scope+seq], [scope+source]', overlays: 'id', kv: 'key', usage: 'id', memfs: '[campaignId+path]', logs: 'id' });
    await old.open();
    await old.table('kv').put({ key: 'kernel.userName', value: 'Hana' });
    await old.table('memories').put({ id: 'm', campaignId: 'a', when: '昨天', text: '方亦楷答应周末带用户看小猫，Hana 说要带猫粮', importance: 2, sourceMessageIds: [], createdAt: 0 });
    await old.table('campaigns').put({ id: 'a', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: { c: '和用户是同桌' }, mood: {}, facts: ['方亦楷欠Hana一份烤冷面'] } });
    await old.table('events').put({ id: 'e', scope: 'a', seq: 1, at: 0, type: 'state.set', source: 's', payload: { entity: 'Hana', attr: '位置', value: '用户在客栈' } });
    await old.table('overlays').put({ id: 'o', campaignId: 'a', title: '用户的家', summary: '', content: 'Hana 搬家了', reason: '', createdAt: 0 });
    old.close();
    const db = new PocketDB(name, []);
    await db.open();
    expect((await db.memories.get('m'))!.text).toBe('方亦楷答应周末带{{user}}看小猫，{{user}} 说要带猫粮');
    const cp = (await db.campaigns.get('a'))!;
    expect(cp.state.relations.c).toBe('和{{user}}是同桌');
    expect(cp.state.facts).toEqual(['方亦楷欠{{user}}一份烤冷面']);
    expect((await db.events.get('e'))!.payload).toMatchObject({ entity: '{{user}}', value: '{{user}}在客栈' });
    expect((await db.overlays.get('o'))!).toMatchObject({ title: '{{user}}的家', content: '{{user}} 搬家了' });
    db.close();
  });
});

describe('PocketDB v9 upgrade', () => {
  it('fills the story start from the earliest message and memory times from their source messages', async () => {
    const Dexie = (await import('dexie')).default;
    const name = 'test-v9-' + Math.random();
    const old = new Dexie(name);
    old.version(800).stores({ worlds: 'id', lore: 'id', characters: 'id', campaigns: 'id, worldId, lastPlayedAt', conversations: 'id, campaignId', messages: 'id, conversationId, ts', memories: 'id, campaignId', events: 'id, scope, [scope+seq], [scope+source]', overlays: 'id', kv: 'key', usage: 'id', memfs: '[campaignId+path]', logs: 'id' });
    await old.open();
    await old.table('campaigns').bulkPut([
      { id: 'a', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 5, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } },
      { id: 'b', worldId: 'w', characterIds: ['c'], name: 'y', createdAt: 7, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } },
    ]);
    await old.table('conversations').put({ id: 'v', campaignId: 'a', kind: 'direct', participantIds: ['c'], pluginId: 'chat' });
    await old.table('messages').bulkPut([
      { id: 'm1', conversationId: 'v', role: 'user', content: [], ts: 300, storyTs: 1000 },
      { id: 'm2', conversationId: 'v', role: 'assistant', content: [], ts: 400, storyTs: 2000 },
    ]);
    await old.table('memories').bulkPut([
      { id: 'k1', campaignId: 'a', when: '今天晚上', text: 't', importance: 2, sourceMessageIds: ['m1', 'm2'], createdAt: 0 },
      { id: 'k2', campaignId: 'a', when: '导入前', text: 't', importance: 3, sourceMessageIds: [], createdAt: 0 },
      { id: 'k3', campaignId: 'a', when: '', text: 't', importance: 2, sourceMessageIds: ['gone'], createdAt: 0 },
    ]);
    old.close();
    const db = new PocketDB(name, []);
    await db.open();
    expect((await db.campaigns.get('a'))!.storyStart).toBe(1000);
    expect((await db.campaigns.get('b'))!.storyStart).toBe(7);
    expect((await db.memories.get('k1'))!.storyTs).toBe(2000);
    expect((await db.memories.get('k2'))!.storyTs).toBeUndefined();
    expect((await db.memories.get('k3'))!.storyTs).toBeUndefined();
    db.close();
  });
});

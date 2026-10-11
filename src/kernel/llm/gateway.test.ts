import { describe, it, expect, vi, beforeEach } from 'vitest';

const kv = new Map<string, unknown>();
const seen: unknown[] = [];
let listed: { id: string; label: string }[] = [];
vi.mock('../storage/db', () => ({
  db: () => ({
    getKV: async (k: string, fb: unknown) => (kv.has(k) ? kv.get(k) : fb),
    setKV: async (k: string, v: unknown) => { kv.set(k, v); },
    usage: { add: async () => {}, where: () => ({ aboveOrEqual: () => ({ toArray: async () => [] }) }), orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => [] }) }) }) },
  }),
}));
vi.mock('./claude', () => ({
  ClaudeProvider: class {
    async chat(req: unknown) { seen.push(req); return { text: 'ok', content: [], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, stopReason: 'end_turn', model: (req as { model: string }).model }; }
    async listModels() { return listed; }
  },
}));
vi.mock('./gate.svelte', () => ({ gate: { confirm: async () => true } }));
vi.mock('../log/log', () => ({ log: { info() {}, warn() {}, error() {} } }));

const base = { system: [], messages: [] };

describe('gateway model roles', () => {
  beforeEach(() => { kv.clear(); seen.length = 0; });

  it('picks model and effort per role: consolidate by purpose, bulk by explicit role, everything else chat', async () => {
    kv.set('kernel.llm', { apiKey: 'k', models: { chat: 'big', consolidate: 'small', bulk: 'mid' }, efforts: { chat: 'high', consolidate: 'low', bulk: 'medium' } });
    const { llm } = await import('./gateway.svelte');
    await llm.boot();
    await llm.chat({ ...base, purpose: 'chat' });
    await llm.chat({ ...base, purpose: 'catchup' });
    await llm.chat({ ...base, purpose: 'consolidate' });
    await llm.chat({ ...base, purpose: 'plugin:shop', role: 'bulk' });
    await llm.chat({ ...base, purpose: 'plugin:shop', role: 'bulk', effort: 'low' });
    expect(seen.map((r) => { const q = r as { model: string; effort: string }; return [q.model, q.effort]; })).toEqual([
      ['big', 'high'], ['big', 'high'], ['small', 'low'], ['mid', 'medium'], ['mid', 'low'],
    ]);
  });

  it('adds thinking room on top of the caller\'s text budget, scaled by effort', async () => {
    kv.set('kernel.llm', { apiKey: 'k', efforts: { chat: 'high', consolidate: 'low', bulk: 'low' } });
    const { llm } = await import('./gateway.svelte');
    await llm.boot();
    await llm.chat({ ...base, purpose: 'plugin:diary', maxTokens: 600 });
    await llm.chat({ ...base, purpose: 'plugin:shop', role: 'bulk', maxTokens: 6000 });
    await llm.chat({ ...base, purpose: 'chat' });
    await llm.chat({ ...base, purpose: 'chat', effort: 'max', maxTokens: 100 });
    expect(seen.map((r) => (r as { maxTokens: number }).maxTokens)).toEqual([600 + 4096, 6000 + 1024, 4096 + 4096, 100 + 16384]);
  });

  it('migrates the old single model/effort into the chat tier and drops the old keys on save', async () => {
    kv.set('kernel.llm', { apiKey: 'k', model: 'claude-fable-5-1', effort: 'xhigh' });
    const { llm } = await import('./gateway.svelte');
    await llm.boot();
    expect(llm.modelFor('chat')).toBe('claude-fable-5-1');
    expect(llm.effortFor('chat')).toBe('xhigh');
    expect(llm.modelFor('bulk')).toBe('claude-haiku-5-5');
    await llm.setRole('bulk', { model: 'claude-sonnet-5-5', effort: 'medium' });
    const stored = kv.get('kernel.llm') as Record<string, unknown>;
    expect(stored.model).toBeUndefined();
    expect(stored.models).toEqual({ chat: 'claude-fable-5-1', consolidate: 'claude-haiku-5-5', bulk: 'claude-sonnet-5-5' });
    expect(stored.efforts).toEqual({ chat: 'xhigh', consolidate: 'low', bulk: 'medium' });
  });

  it('caches the fetched model list in KV and falls back to the built-in table', async () => {
    kv.set('kernel.llm', { apiKey: 'k' });
    const { llm } = await import('./gateway.svelte');
    await llm.boot();
    expect(llm.models.map((m) => m.id)).toContain('claude-opus-5-5');
    listed = [{ id: 'claude-next', label: 'Claude Next' }];
    await llm.refreshModels();
    expect(llm.models).toEqual(listed);
    expect((kv.get('kernel.llm.models') as { models: unknown }).models).toEqual(listed);
    listed = [];
    await expect(llm.refreshModels()).rejects.toThrow();
    expect(llm.models.map((m) => m.id)).toEqual(['claude-next']);
  });
});

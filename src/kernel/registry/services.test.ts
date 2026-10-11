import { describe, it, expect, vi } from 'vitest';

vi.mock('../storage/db', () => ({ db: () => ({}), pluginTable: (id: string, n: string) => `p_${id}_${n}` }));
vi.mock('../data/view', () => ({ dataView: {} }));
vi.mock('../llm/gateway.svelte', () => ({ llm: { configured: false, chat: async () => ({ text: '' }) } }));
vi.mock('../memory/consolidate', () => ({ CONSOLIDATE_MODEL: 'x' }));
vi.mock('../nav/nav.svelte', () => ({ nav: { push() {}, pop() {} } }));

describe('plugin services', () => {
  it('resolves a service only while its plugin is enabled', async () => {
    const { registry } = await import('./registry.svelte');
    const wallet = { balance: async () => 1 };
    registry.register({ id: 'w', name: 'W', version: '0', services: { wallet } });
    registry.register({ id: 's', name: 'S', version: '0' });
    registry.enabled = { w: true, s: true };
    expect(registry.service('wallet')).toBe(wallet);
    expect(registry.service('nope')).toBeUndefined();
    registry.enabled = { w: false, s: true };
    expect(registry.service('wallet')).toBeUndefined();
  });

  it('definePlugin rejects bad service names', async () => {
    const { definePlugin } = await import('../api');
    expect(() => definePlugin({ id: 'x', name: 'x', version: '0', services: { 'Wallet.v2': {} } })).toThrow(/服务名/);
  });
});

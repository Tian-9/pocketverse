import { describe, it, expect } from 'vitest';
import { roleOf, normalizeRoles, DEFAULT_MODELS, DEFAULT_EFFORTS } from './roles';

describe('model roles', () => {
  it('maps purposes to roles: only consolidate is its own tier, explicit role wins', () => {
    expect(roleOf('chat')).toBe('chat');
    expect(roleOf('catchup')).toBe('chat');
    expect(roleOf('plugin:shop')).toBe('chat');
    expect(roleOf('consolidate')).toBe('consolidate');
    expect(roleOf('plugin:shop', 'bulk')).toBe('bulk');
    expect(roleOf('consolidate', 'chat')).toBe('chat');
  });
  it('fills missing tiers with defaults and keeps what is set', () => {
    const r = normalizeRoles({ models: { bulk: 'claude-sonnet-5-5' }, efforts: { chat: 'high' } });
    expect(r.models).toEqual({ ...DEFAULT_MODELS, bulk: 'claude-sonnet-5-5' });
    expect(r.efforts).toEqual({ ...DEFAULT_EFFORTS, chat: 'high' });
  });
  it('migrates the old single model / effort into the chat tier, unless the tier is already set', () => {
    expect(normalizeRoles({ model: 'claude-fable-5-1', effort: 'xhigh' })).toEqual({
      models: { ...DEFAULT_MODELS, chat: 'claude-fable-5-1' }, efforts: { ...DEFAULT_EFFORTS, chat: 'xhigh' },
    });
    expect(normalizeRoles({ model: 'old', models: { chat: 'new' } }).models.chat).toBe('new');
    expect(normalizeRoles({}).models).toEqual(DEFAULT_MODELS);
  });
});

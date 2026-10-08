import { describe, it, expect } from 'vitest';
import { kernelTools } from './tools';

describe('kernel tools', () => {
  it('all tool names satisfy the API pattern', () => {
    for (const t of kernelTools) expect(t.spec.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
  });
});

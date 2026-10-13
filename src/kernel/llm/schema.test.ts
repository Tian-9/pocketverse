import { describe, it, expect } from 'vitest';
import { sanitizeSchema } from './schema';
import { SCHEMA } from '../memory/consolidate';

const BAD = /"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|minLength|maxLength|maxItems|uniqueItems)":/;

describe('sanitizeSchema', () => {
  it('strips unsupported constraints into the description and keeps the rest', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = sanitizeSchema<unknown>({
      type: 'object', properties: {
        n: { type: 'integer', minimum: 1, maximum: 3, description: '星' },
        tags: { type: 'array', maxItems: 3, minItems: 1, items: { type: 'string', maxLength: 20, enum: ['maxItems', 'a'] } },
        list: { type: 'array', minItems: 2, items: { type: 'object', properties: { x: { type: 'string' } } } },
      }, required: ['n'],
    });
    expect(JSON.stringify(s)).not.toMatch(BAD);
    expect(s.properties.n.description).toBe('星（取值 1 到 3）');
    expect(s.properties.tags.minItems).toBe(1);
    expect(s.properties.tags.description).toBe('（最多 3 项）');
    expect(s.properties.tags.items.enum).toEqual(['maxItems', 'a']);
    expect(s.properties.tags.items.description).toBe('（不超过 20 字）');
    expect(s.properties.list).not.toHaveProperty('minItems');
    expect(s.properties.list.items.additionalProperties).toBe(false);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['n']);
  });

  it('the consolidation schema (with annals bag and patch fragments) comes out clean', () => {
    const s = sanitizeSchema(SCHEMA);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(BAD);
    expect(text).toContain('最多 3 项');
    expect(text).toContain('取值 1 到 3');
  });
});

import { describe, it, expect } from 'vitest';
import { expandMacros } from './macros';

describe('expandMacros', () => {
  it('replaces tavern placeholders case-insensitively', () => {
    expect(expandMacros('{{user}}和{{ Char }}坐在一起，<USER>说话', { user: '阿天', char: '方亦楷' })).toBe('阿天和方亦楷坐在一起，阿天说话');
    expect(expandMacros('', { user: 'a', char: 'b' })).toBe('');
  });
});

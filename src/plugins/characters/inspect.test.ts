import { describe, it, expect } from 'vitest';
import { sentenceRange } from './inspect.svelte';

describe('sentenceRange', () => {
  it('covers the sentence around the match including its terminal punctuation', () => {
    const t = '第一句。她今年16岁，住在城北。第三句！';
    const i = t.indexOf('16岁');
    const [s, e] = sentenceRange(t, i, 3);
    expect(t.slice(s, e)).toBe('她今年16岁，住在城北。');
  });
  it('handles matches at the very start and end', () => {
    expect(sentenceRange('16岁', 0, 3)).toEqual([0, 3]);
    const t = '前文\n8岁那年';
    const [s, e] = sentenceRange(t, 3, 2);
    expect(t.slice(s, e)).toBe('8岁那年');
  });
});

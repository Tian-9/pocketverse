import { describe, it, expect } from 'vitest';
import { extractTags } from './tags';

describe('extractTags', () => {
  it('extracts registered tags with attrs and strips them from text', () => {
    const r = extractTags('先这样。\n\n<moment mood="淡">雨停了，书没读完。</moment>\n\n晚安。<other>x</other>', ['moment']);
    expect(r.text).toBe('先这样。\n\n晚安。<other>x</other>');
    expect(r.found).toEqual([{ tag: 'moment', attrs: { mood: '淡' }, body: '雨停了，书没读完。' }]);
  });
  it('is a no-op without registered tags', () => {
    expect(extractTags('<moment>x</moment>', [])).toEqual({ text: '<moment>x</moment>', found: [] });
  });
});

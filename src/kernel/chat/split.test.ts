import { describe, it, expect } from 'vitest';
import { splitReply } from './engine.svelte';

describe('splitReply', () => {
  it('splits on newlines, strips list markers, drops blanks, caps at 6', () => {
    expect(splitReply('在呢\n\n刚躺下\n1. 你咋还没睡')).toEqual(['在呢', '刚躺下', '你咋还没睡']);
    expect(splitReply('一句话。')).toEqual(['一句话。']);
    expect(splitReply(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f\ng\nh']);
  });
});

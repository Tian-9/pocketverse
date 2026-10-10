import { describe, it, expect } from 'vitest';
import { rawlog } from './rawlog.svelte';

describe('rawlog', () => {
  it('records request/event/done in order and clears', () => {
    rawlog.clear();
    rawlog.request({ model: 'm' }, 'chat');
    rawlog.event({ type: 'message_start' });
    rawlog.done({ stop_reason: 'end_turn' });
    expect(rawlog.entries.map((e) => e.kind)).toEqual(['request', 'event', 'done']);
    expect(rawlog.entries[0]!.purpose).toBe('chat');
    rawlog.clear();
    expect(rawlog.entries).toEqual([]);
  });

  it('caps at 2000 entries, dropping the oldest', () => {
    rawlog.clear();
    for (let i = 0; i < 2100; i++) rawlog.event({ i });
    expect(rawlog.entries.length).toBe(2000);
    expect((rawlog.entries[0]!.data as { i: number }).i).toBe(100);
    rawlog.clear();
  });
});

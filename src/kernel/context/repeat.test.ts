import { describe, it, expect } from 'vitest';
import { lastTurnEnds, openingOf, repeatNotice, REPEAT_WINDOW_MS } from './repeat';
import type { Message } from '../storage/db';

const H = 3600_000;
let n = 0;
const msg = (role: Message['role'], text: string, storyTs: number, meta?: Record<string, unknown>): Message =>
  ({ id: String(n++), conversationId: 'v', role, content: [{ type: 'text', text }], ts: storyTs, storyTs, ...(meta ? { meta } : {}) });
const reply = (turn: string, texts: string[], storyTs: number) => texts.map((t) => msg('assistant', t, storyTs, { turn }));

// 截图里的两轮：每轮最后一条都是「明天……🫡」
const night = 20 * H;
const screenshot = [
  msg('user', '冒泡', night),
  ...reply('t1', ['冒什么泡，刚下晚自习就开始在手机上冒，到家没？😂', '到家了就赶紧把门反锁了', '明天下午两点焦姐店里见，别迟到，金毛等你那根五块钱的火腿肠呢🫡'], night),
  msg('user', '想吃宽粉😏', night + 10 * 60_000),
  ...reply('t2', ['大半夜十点了你跟我说想吃宽粉？😂', '校门口那几家早收摊了', '明天从焦姐那儿出来带你去吃，宽粉随便夹，吃不完我照样兜着🫡'], night + 10 * 60_000),
];

describe('repeat notice', () => {
  it('compares the first characters after dropping punctuation, emoji and spaces', () => {
    expect(openingOf('明天下午两点')).toBe('明天');
    expect(openingOf('🫡 「明天」见')).toBe('明天');
    expect(openingOf('😂')).toBe('');
  });

  it('takes the last bubble of each of the last two turns, skipping narration', () => {
    const h = [...screenshot, msg('assistant', '（拍了拍你）', night + 11 * 60_000, { narration: true, turn: 't3' })];
    expect(lastTurnEnds(h).map((e) => e.text.slice(0, 2))).toEqual(['明天', '明天']);
  });

  it('catches the screenshot: two turns ending on 明天… within the same evening', () => {
    const t = repeatNotice(screenshot);
    expect(t).toContain('「明天」开头');
    expect(t).toContain('焦姐店里见');
    expect(t).toContain('宽粉随便夹');
  });

  it('stays quiet when the openings differ, there is only one turn, or the story moved on', () => {
    const differ = [...screenshot.slice(0, -1), msg('assistant', '睡吧，别饿着肚子', night + 10 * 60_000, { turn: 't2' })];
    expect(repeatNotice(differ)).toBe('');
    expect(repeatNotice(screenshot.slice(0, 4))).toBe('');
    // 隔了一夜：每天早上都说「早啊」不算重复
    const morning = [
      ...reply('t1', ['早啊，起了没'], 8 * H),
      ...reply('t2', ['早啊，今天降温'], 8 * H + REPEAT_WINDOW_MS),
    ];
    expect(repeatNotice(morning)).toBe('');
    expect(repeatNotice([...reply('t1', ['早啊'], 8 * H), ...reply('t2', ['早啊'], 9 * H)])).not.toBe('');
  });
});

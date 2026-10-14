import type { Campaign, EpisodicMemory } from '../storage/db';
import { clock } from './clock';

/**
 * 双轨时间（需求文档第 2 节）：剧情日期（存档时钟）之外，再给每件事一个「这局的第几天」。
 * 「第 8 天吵架、第 30 天和好」比两串日期更有时间感；隔得越久「多久以前」写得越粗，模型自然知道该淡化。
 * 日期差全由代码算，不让模型做日期算术。按他的时区、按日历日算，和夏令时无关。
 */
const D = 864e5;
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 这局的第 1 天（剧情时刻）：开局时记下；老存档由 v9 迁移补（最早一条消息） */
export function storyStartOf(cp: Pick<Campaign, 'storyStart' | 'clock' | 'createdAt'>): number {
  return cp.storyStart ?? cp.clock?.anchorStoryTs ?? cp.createdAt;
}

const keyDays = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10))) / D;

/** ts 是这局的第几天（开局那天是第 1 天） */
export function dayOf(ts: number, start: number, tz?: string): number {
  return keyDays(clock.dateKey(ts, tz)) - keyDays(clock.dateKey(start, tz)) + 1;
}

/** 「11/14 周五」 */
export function dateLabel(ts: number, tz?: string): string {
  const k = clock.dateKey(ts, tz);
  return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${WEEK[new Date(k + 'T00:00').getDay()]}`;
}

/** 隔了几天的说法：越久越粗 */
export function agoText(days: number): string {
  if (days < 0) return `${-days} 天后`;
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days < 45) return `${days} 天前`;
  if (days < 335) return `约 ${Math.round(days / 30)} 个月前`;
  return `约 ${Math.max(1, Math.round(days / 365))} 年前`;
}

/** 整理时对话记录里的分隔行：「—— Day 36 · 11/14 周五 ——」 */
export function dayDivider(ts: number, start: number, tz?: string): string {
  return `—— Day ${dayOf(ts, start, tz)} · ${dateLabel(ts, tz)} ——`;
}

/** 老记忆的 when 是「今天晚上」这种相对说法：有了 Day 以后去掉「今天」，只留时段 */
function partOfDay(when: string): string {
  return when.trim().replace(/^(今天|今日)/, '').replace(/^今晚/, '晚上').replace(/^今早/, '早上').trim();
}

/**
 * 记忆的时间：「Day 36（11/14 周五 晚上，4 天前）」。没有剧情时刻的老记忆（来源消息已删）只给原来的文字。
 * 进提示词、主页、导出都用这一个。
 */
export function memoryWhen(m: Pick<EpisodicMemory, 'storyTs' | 'when'>, start: number, now: number, tz?: string): string {
  if (m.storyTs === undefined) return m.when;
  const pod = partOfDay(m.when);
  const ago = dayOf(now, start, tz) - dayOf(m.storyTs, start, tz);
  return `Day ${dayOf(m.storyTs, start, tz)}（${dateLabel(m.storyTs, tz)}${pod ? ' ' + pod : ''}，${agoText(ago)}）`;
}

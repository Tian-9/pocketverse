import type { Message } from '../storage/db';
import { textOf } from '../data/repo';

/**
 * 重复提醒：模型爱照着自己上一轮的样子写，最明显的是结尾那句，比如每轮最后一条都是「明天……🫡」。
 * 笼统地说"别重复"他意识不到，所以由代码抓：连着两轮回复的最后一条开头一样，剧情时间又挨得近，
 * 就在这一轮点名告诉他。只看线上（一条一行的微信），不调模型。见 ARCHITECTURE「850 重复提醒」。
 */

/** 比开头几个字（去掉标点、表情、空白之后） */
export const REPEAT_PREFIX = 2;
/** 两轮的剧情时间相隔不到这么久才算重复；隔久了算新的一段（每天早上都说「早啊」不算） */
export const REPEAT_WINDOW_MS = 6 * 3600_000;

/** 一句话的开头：只留文字和数字，取前 n 个 */
export function openingOf(text: string, n = REPEAT_PREFIX): string {
  return [...text.replace(/[^\p{L}\p{N}]/gu, '')].slice(0, n).join('');
}

interface TurnEnd { text: string; storyTs: number }

/** 最近两轮回复各自的最后一条（不算旁白和空的卡片气泡），旧的在前 */
export function lastTurnEnds(history: Message[]): TurnEnd[] {
  const out: TurnEnd[] = [];
  const seen = new Set<string>();
  for (let i = history.length - 1; i >= 0 && out.length < 2; i--) {
    const m = history[i]!;
    const turn = m.role === 'assistant' && !m.meta?.narration ? m.meta?.turn : undefined;
    if (typeof turn !== 'string' || seen.has(turn)) continue;
    const text = textOf(m).trim();
    if (!text) continue;
    seen.add(turn);
    out.unshift({ text, storyTs: m.storyTs ?? m.ts });
  }
  return out;
}

const clip = (t: string) => (t.length > 40 ? t.slice(0, 40) + '…' : t);

/** 抓到了就给这一轮的提醒，没抓到给空 */
export function repeatNotice(history: Message[]): string {
  const ends = lastTurnEnds(history);
  if (ends.length < 2) return '';
  const [a, b] = ends as [TurnEnd, TurnEnd];
  const head = openingOf(b.text);
  if (head.length < REPEAT_PREFIX || openingOf(a.text) !== head) return '';
  if (Math.abs(b.storyTs - a.storyTs) >= REPEAT_WINDOW_MS) return '';
  return `（你最近两次回复的最后一条都是「${head}」开头：「${clip(a.text)}」「${clip(b.text)}」。这次结尾别再这样开头，也别用同一个套路收尾：可以换个话题、换种语气，或者不收尾，话说完就停。）`;
}

import type { Message } from '../storage/db';
import { textOf } from '../data/repo';

/**
 * 追加段：变得少的内容（钱包、他有的东西），不每轮在尾巴里全价重发，变了才往历史里写一条隐藏消息
 * （role 'system' + meta.context = 段 id，你看不到，模型当作用户侧内容看到），之后跟着历史一起被缓存。
 *
 * - 每次写的都是这一段的完整快照，不是变化量：模型不用自己拼，同一种以最后出现的为准（规则里写明）。
 * - 「变了」= 当前文字和窗口里最近一份不一样；窗口里一份都没有（推进时间截掉了、滑出 60 条）也补一份。
 * - 新写的排在这一轮你的话前面：上一轮的缓存断点在他上次回复末尾，插在它之后不碰缓存前缀。
 */
export interface AppendItem { id: string; text: string }

export const isContext = (m: Pick<Message, 'meta'>) => typeof m.meta?.context === 'string';

/** 拼装时实际进上下文的历史：最近 windowSize 条；推进时间之前只留 chapterTail 条衔接。拼装器和追加段共用 */
export function visibleHistory(history: Message[], windowSize = 60, chapterTail = 6): Message[] {
  let recent = history.slice(-windowSize);
  const cut = recent.map((m, i) => (m.meta?.chapter ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  if (cut > chapterTail) recent = recent.slice(cut - chapterTail);
  return recent;
}

/** 哪些段要写新快照：有内容，且和窗口里最近一份不一样（或窗口里没有） */
export function pendingAppends(visible: Message[], items: AppendItem[]): AppendItem[] {
  return items.filter((it) => {
    if (!it.text.trim()) return false;
    const last = [...visible].reverse().find((m) => m.meta?.context === it.id);
    return !last || textOf(last) !== it.text;
  });
}

/** 第 i 条新快照的 ts：最后一条是你的话就排在它前面（相差不到 1 毫秒），否则排在最后 */
export function appendTs(history: Message[], i: number, now: number): number {
  const last = history[history.length - 1];
  if (last?.role === 'user' && !isContext(last)) return last.ts - 0.5 + i * 0.01;
  return Math.max(now, (last?.ts ?? 0) + 1) + i * 0.01;
}

export function contextMessage(conversationId: string, it: AppendItem, ts: number, storyTs: number, id: string): Message {
  return { id, conversationId, role: 'system', content: [{ type: 'text', text: it.text }], ts, storyTs, meta: { context: it.id } };
}

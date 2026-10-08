import type { ChatMessage, TextBlock } from '../llm/types';
import type { Character, Message } from '../storage/db';
import { textOf } from '../data/repo';

export interface AssembleInput {
  character: Character;
  userName: string;
  history: Message[];
  /** 本轮用户输入；为空表示让角色接着说（重新生成） */
  userText?: string;
  /** 易变内容，放最后一条用户消息，永不进 system */
  volatile?: string[];
  /** 最近原文消息条数，更早的先直接丢弃（M2 换成压缩） */
  windowSize?: number;
}

const RULES = [
  '你在扮演一个角色，和用户进行沉浸式的文字角色扮演。',
  '始终以角色的身份、口吻和视角说话，不要跳出角色解释自己是 AI。',
  '回复像手机聊天：一次一到三段，口语化，长度和对方匹配，不要独白。',
  '不要替用户说话或决定用户的行动。',
  '用中文回复，除非角色设定要求其他语言。',
].join('\n');

/**
 * 拼装请求。缓存断点两处：system 末尾、倒数第二条消息末尾。
 * 顺序必须稳定：规则 → 角色 → 用户，易变内容只进最后一条用户消息。
 */
export function assemble(input: AssembleInput): { system: TextBlock[]; messages: ChatMessage[] } {
  const { character, userName, windowSize = 60 } = input;
  const system: TextBlock[] = [
    { type: 'text', text: `# 规则\n${RULES}` },
    { type: 'text', text: `# 你扮演的角色：${character.name}\n${character.core}` },
    { type: 'text', text: `# 对话对象\n用户的名字是「${userName}」。`, cache: true },
  ];

  const recent = input.history.slice(-windowSize);
  const messages: ChatMessage[] = [];
  for (const m of recent) {
    if (m.role === 'system') continue;
    const text = textOf(m).trim();
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) {
      last.content.push({ type: 'text', text });
    } else {
      messages.push({ role: m.role, content: [{ type: 'text', text }] });
    }
  }

  const tail: string[] = [...(input.volatile ?? [])];
  if (input.userText?.trim()) tail.push(input.userText.trim());

  if (tail.length) {
    const last = messages[messages.length - 1];
    if (last?.role === 'user') last.content.push({ type: 'text', text: tail.join('\n\n') });
    else messages.push({ role: 'user', content: [{ type: 'text', text: tail.join('\n\n') }] });
  }
  // API 要求首条是 user
  if (messages[0]?.role === 'assistant') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '（对话开始）' }] });
  }
  // 末条必须是 user：重新生成时去掉末尾的 assistant
  while (messages.length && messages[messages.length - 1]!.role === 'assistant') messages.pop();
  if (!messages.length) messages.push({ role: 'user', content: [{ type: 'text', text: '（对话开始）' }] });

  // 断点 2：倒数第二条消息的最后一块
  if (messages.length >= 2) {
    const prev = messages[messages.length - 2]!;
    prev.content[prev.content.length - 1]!.cache = true;
  }
  return { system, messages };
}

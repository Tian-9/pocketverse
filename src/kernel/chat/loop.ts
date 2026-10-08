import type { Block, ChatMessage, ChatResult, ChatRequest, StreamHooks, TextBlock, ToolSpec } from '../llm/types';

export interface LoopTool { spec: ToolSpec; run: (input: unknown) => Promise<string> }
export interface LoopOptions { maxRounds?: number; hooks?: StreamHooks; onToolUsed?: (name: string) => void }
export type ChatFn = (req: Omit<ChatRequest, 'model' | 'maxTokens' | 'effort'> & Partial<ChatRequest>, hooks?: StreamHooks) => Promise<ChatResult>;

/**
 * 工具循环：模型要求调工具 → 执行 → 把结果作为 user 消息追加 → 再调，直到不再调工具或到轮数上限。
 * 同一轮内 assistant 的完整内容（含 opaque 思考块）原样回传，满足 preserved thinking。
 */
export async function runToolLoop(
  chat: ChatFn,
  base: { system: TextBlock[]; messages: ChatMessage[]; purpose: string; conversationId?: string; names?: { user: string; assistant: string } },
  tools: LoopTool[],
  opts: LoopOptions = {},
): Promise<{ result: ChatResult; toolsUsed: string[]; rounds: number }> {
  const maxRounds = opts.maxRounds ?? 4;
  const messages: ChatMessage[] = base.messages.map((m) => ({ role: m.role, content: [...m.content] }));
  const specs = tools.map((t) => t.spec);
  const toolsUsed: string[] = [];
  let rounds = 0;
  let last: ChatResult;
  for (;;) {
    rounds++;
    last = await chat({ system: base.system, messages, tools: specs, purpose: base.purpose, conversationId: base.conversationId, names: base.names }, opts.hooks);
    const calls = last.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!calls.length || last.stopReason !== 'tool_use' || rounds > maxRounds) break;
    messages.push({ role: 'assistant', content: last.content });
    const results: Block[] = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      opts.onToolUsed?.(call.name);
      const tool = tools.find((t) => t.spec.name === call.name);
      try {
        const out = tool ? await tool.run(call.input) : `没有名为 ${call.name} 的工具`;
        results.push({ type: 'tool_result', toolUseId: call.id, content: out || '（空）', isError: !tool });
      } catch (e) {
        results.push({ type: 'tool_result', toolUseId: call.id, content: e instanceof Error ? e.message : String(e), isError: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { result: last!, toolsUsed, rounds };
}

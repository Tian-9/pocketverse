export type Role = 'user' | 'assistant';

export interface TextBlock { type: 'text'; text: string; cache?: boolean }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean; cache?: boolean }
/** 适配器私有块（如 thinking），同一轮工具循环内原样回传 */
export interface OpaqueBlock { type: 'opaque'; provider: string; block: unknown }
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | OpaqueBlock;

export interface ChatMessage { role: Role; content: Block[] }

/** 自定义工具（JSON schema），或适配器内置工具（如 Claude 的 memory） */
export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  builtin?: 'memory';
}

export interface ChatRequest {
  model: string;
  system: TextBlock[];
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** 结构化输出的 JSON schema */
  jsonSchema?: Record<string, unknown>;
  /** 记账用途标签，如 'chat' | 'consolidate' */
  purpose: string;
  conversationId?: string;
  /** 要求返回思考摘要（Anthropic 官方的 summarized 展示，不是原始思维链） */
  showThinking?: boolean;
  /** 仅用于预览显示的名字，不发给模型 */
  names?: { user: string; assistant: string };
}

export interface StreamHooks {
  onText?(delta: string): void;
  onStatus?(status: string): void;
  signal?: AbortSignal;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface ChatResult {
  text: string;
  /** 思考摘要，开了 showThinking 才有 */
  thinking?: string;
  /** 完整回复块，含 tool_use 和 opaque，用于工具循环回传 */
  content: Block[];
  usage: Usage;
  stopReason: string;
  model: string;
  refusal?: { category: string | null; explanation?: string | null };
}

export interface LlmProvider {
  id: string;
  capabilities: { tools: boolean; caching: boolean; contextEditing: boolean; memoryTool: boolean };
  chat(req: ChatRequest, hooks?: StreamHooks): Promise<ChatResult>;
}

export class LlmError extends Error {
  constructor(message: string, public readonly kind: 'auth' | 'rate' | 'network' | 'request' | 'server' | 'aborted' | 'unknown') {
    super(message);
  }
}

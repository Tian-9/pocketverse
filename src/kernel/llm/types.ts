export type Role = 'user' | 'assistant';

/** 一段文本，可选缓存断点 */
export interface TextBlock { type: 'text'; text: string; cache?: boolean }

export interface ChatMessage { role: Role; content: TextBlock[] }

export interface ChatRequest {
  model: string;
  system: TextBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** 记账用途标签，如 'chat' | 'consolidate' */
  purpose: string;
  conversationId?: string;
}

export interface StreamHooks {
  onText?(delta: string): void;
  onStatus?(status: string): void;
  signal?: AbortSignal;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface ChatResult {
  text: string;
  usage: Usage;
  stopReason: string;
  /** 实际服务的模型（fallback 时可能不同） */
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

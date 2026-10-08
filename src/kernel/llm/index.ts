/** 模型网关。M1 实现 Claude 适配器；这里先定接口，让上层能编译。 */
export interface ChatRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: unknown[];
  maxTokens?: number;
}
export interface StreamHooks {
  onText?(delta: string): void;
  onTool?(name: string): void;
}
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ChatResult { text: string; usage: Usage; stopReason: string }
export interface LlmProvider {
  id: string;
  capabilities: { tools: boolean; caching: boolean; contextEditing: boolean; memoryTool: boolean };
  chat(req: ChatRequest, hooks?: StreamHooks): Promise<ChatResult>;
}

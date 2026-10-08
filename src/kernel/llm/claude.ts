import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ChatRequest, ChatResult, LlmProvider, StreamHooks } from './types';
import { LlmError } from './types';

/**
 * Claude 适配器。浏览器直连，Key 在本机。
 * - 缓存：system 末尾和倒数第二条消息末尾各一个断点，由拼装器通过 block.cache 标记。
 * - fallback：开服务端自动回退，安全分类器拒答时换模型重跑。
 * - 上下文编辑：清旧工具结果（M2 接工具后生效，现在无副作用）。
 */
export class ClaudeProvider implements LlmProvider {
  id = 'claude';
  capabilities = { tools: true, caching: true, contextEditing: true, memoryTool: true };
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  async chat(req: ChatRequest, hooks: StreamHooks = {}): Promise<ChatResult> {
    const system: BetaTextBlockParam[] = req.system.map((b) => ({
      type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
    const messages: BetaMessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content.map((b) => ({
        type: 'text' as const, text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      })),
    }));

    try {
      hooks.onStatus?.('thinking');
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system,
          messages,
          ...(req.effort ? { output_config: { effort: req.effort } } : {}),
          betas: ['server-side-fallback-2026-07-01', 'context-management-2025-06-27'],
          fallbacks: 'default',
          context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
        },
        { signal: hooks.signal },
      );

      let text = '';
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (text === '') hooks.onStatus?.('typing');
          text += ev.delta.text;
          hooks.onText?.(ev.delta.text);
        }
      }
      const final = await stream.finalMessage();
      const u = final.usage;
      const result: ChatResult = {
        text,
        model: final.model,
        stopReason: final.stop_reason ?? 'end_turn',
        usage: {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        },
      };
      if (final.stop_reason === 'refusal') {
        result.refusal = { category: final.stop_details?.category ?? null, explanation: final.stop_details?.explanation ?? null };
      }
      return result;
    } catch (e) {
      throw toLlmError(e);
    }
  }
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new LlmError('API Key 无效或没有权限', 'auth');
  if (e instanceof Anthropic.RateLimitError) return new LlmError('请求太频繁或额度用尽，稍后再试', 'rate');
  if (e instanceof Anthropic.BadRequestError) return new LlmError(`请求被拒绝：${e.message}`, 'request');
  if (e instanceof Anthropic.InternalServerError) return new LlmError('Anthropic 服务端出错，稍后再试', 'server');
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('连不上 Anthropic，检查网络或代理', 'network');
  if (e instanceof Anthropic.APIUserAbortError || (e as { name?: string })?.name === 'AbortError') return new LlmError('已停止', 'aborted');
  return new LlmError(e instanceof Error ? e.message : String(e), 'unknown');
}

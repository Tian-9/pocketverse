import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessageParam, BetaTextBlockParam, BetaContentBlockParam, BetaToolUnion, BetaContentBlock, BetaTool,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Block, ChatRequest, ChatResult, LlmProvider, StreamHooks } from './types';
import { LlmError } from './types';
import { rawlog } from './rawlog.svelte';

/**
 * Claude 适配器。浏览器直连，Key 在本机。
 * - 缓存：拼装器用 block.cache 标断点，这里翻译成 cache_control。
 * - 工具：自定义工具走 JSON schema；memory 走内置 memory_20250818。
 * - fallback：服务端自动回退，安全分类器拒答时换模型重跑。
 * - 上下文编辑：自动清旧工具结果。
 * - 联网：req.web 开着时挂服务端 web_search / web_fetch，由 Anthropic 执行，结果块原样回传。
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
    const messages: BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content.map(toParam) }));
    const custom: BetaToolUnion[] = (req.tools ?? []).map((t) => t.builtin === 'memory'
      ? { type: 'memory_20250818', name: 'memory' }
      : { name: t.name, description: t.description, input_schema: (t.inputSchema ?? { type: 'object', properties: {} }) as BetaTool['input_schema'] });
    const server: BetaToolUnion[] = req.web
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3, max_content_tokens: 8000 }]
      : [];
    const all = [...custom, ...server];
    const tools = all.length ? all : undefined;

    const params = {
      model: req.model,
      max_tokens: req.maxTokens,
      system,
      messages,
      ...(tools ? { tools } : {}),
      thinking: { type: 'adaptive' as const, display: req.showThinking ? ('summarized' as const) : ('omitted' as const) },
      output_config: {
        ...(req.effort ? { effort: req.effort } : {}),
        ...(req.jsonSchema ? { format: { type: 'json_schema' as const, schema: req.jsonSchema } } : {}),
      },
      betas: ['server-side-fallback-2026-07-01', 'context-management-2025-06-27'],
      fallbacks: 'default' as const,
      context_management: { edits: [{ type: 'clear_tool_uses_20250919' as const }] },
    };
    try {
      hooks.onStatus?.('thinking');
      rawlog.request(requestSummary(params), req.purpose);
      const stream = this.client.beta.messages.stream(params, { signal: hooks.signal });

      let text = '';
      let thinking = '';
      for await (const ev of stream) {
        rawlog.event(ev);
        if (ev.type === 'content_block_delta' && ev.delta.type === 'thinking_delta') {
          thinking += ev.delta.thinking;
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (text === '') hooks.onStatus?.('typing');
          text += ev.delta.text;
          hooks.onText?.(ev.delta.text);
        } else if (ev.type === 'content_block_start' && (ev.content_block.type === 'tool_use' || ev.content_block.type === 'server_tool_use')) {
          hooks.onStatus?.('tool:' + ev.content_block.name);
        }
      }
      const final = await stream.finalMessage();
      const u = final.usage;
      const serverTools = final.content.filter((b) => b.type === 'server_tool_use').map((b) => b.name);
      const result: ChatResult = {
        text,
        ...(thinking.trim() ? { thinking: thinking.trim() } : {}),
        content: final.content.map(fromBlock),
        model: final.model,
        stopReason: final.stop_reason ?? 'end_turn',
        ...(serverTools.length ? { serverTools } : {}),
        usage: {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          ...(u.server_tool_use?.web_search_requests ? { webSearches: u.server_tool_use.web_search_requests } : {}),
        },
      };
      if (final.stop_reason === 'refusal') {
        result.refusal = { category: final.stop_details?.category ?? null, explanation: final.stop_details?.explanation ?? null };
      }
      rawlog.done({
        stop_reason: final.stop_reason,
        model: final.model,
        content: final.content.map((b) => (b.type === 'tool_use' || b.type === 'server_tool_use' ? `${b.type}: ${b.name}` : b.type)),
        usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens },
      });
      return result;
    } catch (e) {
      const err = toLlmError(e);
      rawlog.error(`${err.kind}：${err.message}`);
      throw err;
    }
  }
}

/** 请求信封摘要：正文只记长度不记内容，看结构用。 */
function requestSummary(p: {
  model: string; max_tokens: number; system: BetaTextBlockParam[]; messages: BetaMessageParam[];
  tools?: BetaToolUnion[]; thinking: unknown; output_config: unknown; betas: string[]; fallbacks: string; context_management: unknown;
}): unknown {
  return {
    model: p.model,
    max_tokens: p.max_tokens,
    thinking: p.thinking,
    output_config: p.output_config,
    betas: p.betas,
    fallbacks: p.fallbacks,
    context_management: p.context_management,
    ...(p.tools ? { tools: p.tools.map((t) => ('input_schema' in t ? t.name : `${(t as { type?: string }).type}`)) } : {}),
    system: p.system.map((b) => ({ 字数: b.text.length, ...(b.cache_control ? { cache_control: b.cache_control } : {}) })),
    messages: p.messages.map((m) => ({
      role: m.role,
      blocks: typeof m.content === 'string' ? ['text'] : m.content.map((b) => {
        const cached = 'cache_control' in b && b.cache_control;
        if (b.type === 'text') return `text(${b.text.length} 字)${cached ? ' ⟨缓存断点⟩' : ''}`;
        if (b.type === 'tool_use') return `tool_use: ${b.name}`;
        if (b.type === 'tool_result') return `tool_result${cached ? ' ⟨缓存断点⟩' : ''}`;
        return b.type;
      }),
    })),
  };
}

function toParam(b: Block): BetaContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}), ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) };
    case 'opaque':
      return b.block as BetaContentBlockParam;
  }
}

function fromBlock(b: BetaContentBlock): Block {
  if (b.type === 'text') return { type: 'text', text: b.text };
  if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
  // thinking / redacted_thinking 等：原样保留，同一轮回传
  return { type: 'opaque', provider: 'claude', block: b };
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

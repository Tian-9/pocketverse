import type { ChatRequest } from './types';
import { estimateTokens } from '../context/tokens';

export interface PendingPreview { text: string; tokens: number; purpose: string; model: string; resolve: (ok: boolean) => void }

/** 发送前预览：开着时每一次模型调用都先把完整请求渲染成文本等用户确认。 */
class PromptGate {
  pending = $state<PendingPreview | null>(null);

  confirm(req: ChatRequest): Promise<boolean> {
    const text = render(req);
    return new Promise((resolve) => {
      // 已经有一个在等的话，排队到它之后
      const start = () => { this.pending = { text, tokens: estimateTokens(text), purpose: req.purpose, model: req.model, resolve: (ok) => { this.pending = null; resolve(ok); } }; };
      if (!this.pending) start();
      else { const prev = this.pending.resolve; this.pending.resolve = (ok) => { prev(ok); start(); }; }
    });
  }
}

export function render(req: ChatRequest): string {
  const out: string[] = [];
  out.push(`模型：${req.model}　用途：${req.purpose}　effort：${req.effort ?? '默认'}　max_tokens：${req.maxTokens}`);
  if (req.tools?.length) out.push(`工具：${req.tools.map((t) => t.name).join('、')}`);
  if (req.web) out.push('联网：web_search、web_fetch（Anthropic 服务端执行，每次搜索 $0.01）');
  if (req.jsonSchema) out.push('输出：按 JSON schema 结构化');
  out.push('', '════════ SYSTEM ════════');
  req.system.forEach((b, i) => { out.push(`--- 块 ${i + 1}${b.cache ? '  ⟨缓存断点⟩' : ''} ---`, b.text); });
  out.push('', '════════ MESSAGES ════════');
  for (const m of req.messages) {
    out.push(`--- ${m.role === 'user' ? (req.names?.user ?? '用户') : (req.names?.assistant ?? '角色')} ---`);
    for (const b of m.content) {
      if (b.type === 'text') out.push(b.text + (b.cache ? '\n⟨缓存断点⟩' : ''));
      else if (b.type === 'tool_use') out.push(`[调用工具 ${b.name}] ${JSON.stringify(b.input)}`);
      else if (b.type === 'tool_result') out.push(`[工具结果${b.isError ? '（出错）' : ''}]\n${b.content}`);
      else if (b.type === 'opaque' && isServerBlock(b.block)) out.push(`[${serverBlockLabel(b.block)}，原样回传]`);
      else out.push('[思考块，原样回传]');
    }
  }
  return out.join('\n');
}

function isServerBlock(b: unknown): b is { type: string; name?: string } {
  const t = (b as { type?: string })?.type ?? '';
  return t === 'server_tool_use' || t.endsWith('_tool_result');
}
function serverBlockLabel(b: { type: string; name?: string }): string {
  if (b.type === 'server_tool_use') return `服务端工具 ${b.name ?? ''}`;
  return '服务端工具结果';
}

export const gate = new PromptGate();

import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { UsageRecord } from '../storage/db';
import { ClaudeProvider } from './claude';
import { costUsd } from './pricing';
import type { ChatRequest, ChatResult, LlmProvider, StreamHooks } from './types';
import { LlmError } from './types';
import { gate } from './gate.svelte';

export interface LlmSettings {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** 允许模型用工具（世界书检索、记忆等） */
  tools?: boolean;
  /** 每次调用前预览完整请求，确认才发 */
  preview?: boolean;
  /** 显示思考摘要 */
  showThinking?: boolean;
}

const DEFAULTS: LlmSettings = { apiKey: '', model: 'claude-opus-5-5', effort: 'medium', maxTokens: 4096, tools: true };

export interface UsageStats {
  todayUsd: number; monthUsd: number; requests: number;
  hitRate: number; // 最近 50 次请求的缓存命中率
}

/** 模型网关：持有设置、构造适配器、统一记账。插件通过 ctx.llm 间接调用。 */
class Gateway {
  settings = $state<LlmSettings>({ ...DEFAULTS });
  stats = $state<UsageStats>({ todayUsd: 0, monthUsd: 0, requests: 0, hitRate: 0 });
  private provider: LlmProvider | null = null;

  async boot() {
    this.settings = { ...DEFAULTS, ...(await db().getKV<Partial<LlmSettings>>('kernel.llm', {})) };
    await this.refreshStats();
  }

  get configured() {
    return this.settings.apiKey.trim().length > 0;
  }

  async save(patch: Partial<LlmSettings>) {
    this.settings = { ...this.settings, ...patch };
    await db().setKV('kernel.llm', $state.snapshot(this.settings));
    this.provider = null;
  }

  private get p(): LlmProvider {
    if (!this.configured) throw new LlmError('还没有配置 API Key', 'auth');
    if (!this.provider) this.provider = new ClaudeProvider(this.settings.apiKey.trim());
    return this.provider;
  }

  async chat(req: Omit<ChatRequest, 'model' | 'maxTokens' | 'effort'> & Partial<Pick<ChatRequest, 'model' | 'maxTokens' | 'effort'>>, hooks?: StreamHooks): Promise<ChatResult> {
    const full: ChatRequest = {
      model: req.model ?? this.settings.model,
      maxTokens: req.maxTokens ?? this.settings.maxTokens,
      effort: req.effort ?? this.settings.effort,
      showThinking: req.purpose === 'chat' ? !!this.settings.showThinking : false,
      ...req,
    };
    if (this.settings.preview) {
      const ok = await gate.confirm(full);
      if (!ok) throw new LlmError('你取消了发送', 'aborted');
    }
    const result = await this.p.chat(full, hooks);
    await this.record(full, result);
    return result;
  }

  /** 连通性测试：最小请求 */
  async ping(): Promise<string> {
    const r = await this.p.chat({
      model: this.settings.model, maxTokens: 64, purpose: 'ping',
      system: [{ type: 'text', text: '只回复两个字：好的' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }],
    });
    await this.record({ model: this.settings.model, purpose: 'ping' } as ChatRequest, r);
    return r.text.trim();
  }

  private async record(req: ChatRequest, r: ChatResult) {
    const rec: UsageRecord = {
      id: ulid(), ts: Date.now(), model: r.model || req.model, conversationId: req.conversationId, purpose: req.purpose,
      ...r.usage, costUsd: costUsd(r.model || req.model, r.usage),
    };
    await db().usage.add(rec);
    await this.refreshStats();
  }

  async refreshStats() {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const month = await db().usage.where('ts').aboveOrEqual(monthStart).toArray();
    const recent = await db().usage.orderBy('ts').reverse().limit(50).toArray();
    const sum = recent.reduce((a, r) => ({ input: a.input + r.input, cacheRead: a.cacheRead + r.cacheRead, cacheWrite: a.cacheWrite + r.cacheWrite }), { input: 0, cacheRead: 0, cacheWrite: 0 });
    const total = sum.input + sum.cacheRead + sum.cacheWrite;
    this.stats = {
      todayUsd: month.filter((r) => r.ts >= dayStart).reduce((a, r) => a + r.costUsd, 0),
      monthUsd: month.reduce((a, r) => a + r.costUsd, 0),
      requests: month.length,
      hitRate: total === 0 ? 0 : sum.cacheRead / total,
    };
  }
}

export const llm = new Gateway();

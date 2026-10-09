import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { LogRecord } from '../storage/db';
import { bus } from '../bus/bus';

export type LogLevel = 'info' | 'warn' | 'error';
const KEEP = 1000;

/**
 * 本地日志：写进 Dexie 的 logs 表，设置页能看、能复制。
 * 记录决策和结果（为什么没合并、请求花了多少、哪里出错），不记正文。
 */
class Logger {
  private writes = 0;
  private queue: Promise<unknown> = Promise.resolve();

  boot() {
    window.addEventListener('error', (e) => this.error('window', e.message, { at: `${e.filename}:${e.lineno}` }));
    window.addEventListener('unhandledrejection', (e) => this.error('window', '未处理的 Promise 拒绝', { reason: String(e.reason?.message ?? e.reason) }));
    bus.on('app.opened', (p) => this.info('app', `打开 ${p.pluginId}`));
    bus.on('app.closed', (p) => this.info('app', `关闭 ${p.pluginId}，回到桌面`));
    bus.on('app.resumed', (p) => this.info('app', `回到前台，离开了 ${Math.round(p.elapsedMs / 60000)} 分钟`));
    bus.on('llm.turn.error', (p) => this.error('chat', p.message, { conversationId: p.conversationId }));
    bus.on('memory.consolidated', (p) => this.info('consolidate', `合并完成：${p.memories} 条记忆，${p.overlays} 条变化`, { campaignId: p.campaignId }));
    bus.on('notify', (p) => this.info('notify', p.title, p.body ? { body: p.body } : undefined));
    this.info('app', '启动', { build: typeof __BUILD__ === 'string' ? __BUILD__ : 'dev' });
  }

  info(tag: string, message: string, data?: Record<string, unknown>) { this.write('info', tag, message, data); }
  warn(tag: string, message: string, data?: Record<string, unknown>) { this.write('warn', tag, message, data); }
  error(tag: string, message: string, data?: Record<string, unknown>) { this.write('error', tag, message, data); }

  private write(level: LogLevel, tag: string, message: string, data?: Record<string, unknown>) {
    const rec: LogRecord = { id: ulid(), ts: Date.now(), level, tag, message, ...(data ? { data: safe(data) } : {}) };
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`[${tag}] ${message}`, data ?? '');
    this.queue = this.queue.then(async () => {
      try {
        await db().logs.add(rec);
        if (++this.writes % 50 === 0) await this.trim();
      } catch { /* 库还没开或者满了，日志不能把主流程弄挂 */ }
    });
  }

  async trim() {
    const n = await db().logs.count();
    if (n <= KEEP) return;
    const old = await db().logs.orderBy('ts').limit(n - KEEP).primaryKeys();
    await db().logs.bulkDelete(old);
  }

  async recent(limit = 300): Promise<LogRecord[]> { return db().logs.orderBy('ts').reverse().limit(limit).toArray(); }
  async clear() { await db().logs.clear(); }
  /** 导出成文本，方便复制发给开发者 */
  async dump(limit = 1000): Promise<string> {
    const rows = await this.recent(limit);
    return rows.reverse().map(fmt).join('\n');
  }
}

export function fmt(r: LogRecord): string {
  const t = new Date(r.ts).toLocaleString('zh-CN', { hour12: false });
  return `${t} ${r.level.toUpperCase().padEnd(5)} [${r.tag}] ${r.message}${r.data ? ' ' + JSON.stringify(r.data) : ''}`;
}

/** 日志数据必须可结构化克隆，且不要太长 */
function safe(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (typeof v === 'string') out[k] = v.length > 300 ? v.slice(0, 300) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else { try { out[k] = JSON.parse(JSON.stringify(v)); } catch { out[k] = String(v); } }
  }
  return out;
}

export const log = new Logger();

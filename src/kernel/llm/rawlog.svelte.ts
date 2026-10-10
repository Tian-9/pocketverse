/**
 * 原始流记录：把每次请求发出的信封和收到的 SSE 事件原样留一份，
 * 给设置里的「原始流」页看。只存内存，刷新即清，不进 Dexie。
 */
export interface RawEntry {
  id: number;
  ts: number;
  kind: 'request' | 'event' | 'done' | 'error';
  /** 请求用途（chat / consolidate / catchup…），只有 request 条目带 */
  purpose?: string;
  data: unknown;
}

/** 内存上限：超过后丢最旧的，避免长聊把内存吃满 */
const CAP = 2000;

class RawLog {
  entries = $state<RawEntry[]>([]);
  private seq = 0;

  private push(kind: RawEntry['kind'], data: unknown, purpose?: string) {
    this.entries.push({ id: ++this.seq, ts: Date.now(), kind, data, ...(purpose ? { purpose } : {}) });
    if (this.entries.length > CAP) this.entries.splice(0, this.entries.length - CAP);
  }

  request(summary: unknown, purpose: string) { this.push('request', summary, purpose); }
  event(ev: unknown) { this.push('event', ev); }
  done(info: unknown) { this.push('done', info); }
  error(message: string) { this.push('error', { message }); }
  clear() { this.entries = []; }
}

export const rawlog = new RawLog();

import { bus } from '../bus/bus';

export interface NavEntry { pluginId: string; screen: string; params?: Record<string, unknown> }

interface HistoryEntry { token: number; kind: 'screen' | 'overlay'; close?: () => void }

/**
 * 界面栈 + 浏览器历史。
 * 每次 push 界面或打开弹窗都往 history 里记一条，系统返回手势/返回键（popstate）
 * 就是"关掉最上面的弹窗，或回上一页"。所有后退最终都走 popstate，避免两套状态打架。
 */
class Nav {
  stack = $state<NavEntry[]>([]);
  top = $derived(this.stack[this.stack.length - 1] ?? null);
  private entries: HistoryEntry[] = [];
  private token = 0;
  private hasHistory = typeof history !== 'undefined';

  boot() {
    if (!this.hasHistory) return;
    history.replaceState({ pv: 0 }, '');
    window.addEventListener('popstate', (e) => this.onPop((e.state as { pv?: number } | null)?.pv ?? 0));
  }

  push(pluginId: string, screen: string, params?: Record<string, unknown>) {
    const first = this.stack.length === 0;
    this.stack.push({ pluginId, screen, params });
    this.record('screen');
    if (first) bus.emit('app.opened', { pluginId });
  }

  /** 界面上的返回按钮：走历史后退，popstate 里真正出栈。返回的 Promise 在出栈完成后 resolve，之后再 push 才安全。 */
  pop(): Promise<void> {
    if (!this.stack.length) return Promise.resolve();
    if (this.hasHistory && this.entries.length) return this.goBack(1);
    this.popScreen();
    return Promise.resolve();
  }

  home(): Promise<void> {
    if (this.hasHistory && this.entries.length) return this.goBack(this.entries.length);
    while (this.stack.length) this.popScreen();
    return Promise.resolve();
  }

  /** 历史后退是异步的：等 popstate 处理完再 resolve */
  private waiters: (() => void)[] = [];
  private goBack(n: number): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      history.go(-n);
    });
  }

  /** 弹窗打开时登记，返回手势会先关它 */
  openOverlay(close: () => void): number {
    return this.record('overlay', close);
  }
  /** 弹窗被程序关掉（点背景、保存）：从登记里移除，并回退对应的历史记录 */
  closeOverlay(token: number) {
    const i = this.entries.findIndex((e) => e.token === token);
    if (i < 0) return;
    const above = this.entries.length - i;
    this.entries.splice(i, 1);
    // 只回退这一条；如果它不在最顶上（极少见），上面的条目保留
    if (this.hasHistory && above === 1) history.back();
  }

  private record(kind: HistoryEntry['kind'], close?: () => void): number {
    const token = ++this.token;
    this.entries.push({ token, kind, close });
    if (this.hasHistory) history.pushState({ pv: token }, '');
    return token;
  }

  private onPop(target: number) {
    while (this.entries.length && this.entries[this.entries.length - 1]!.token > target) {
      const en = this.entries.pop()!;
      if (en.kind === 'overlay') en.close?.();
      else this.popScreen();
    }
    const w = this.waiters.splice(0);
    for (const r of w) r();
  }

  private popScreen() {
    const left = this.stack.pop();
    if (left && this.stack.length === 0) bus.emit('app.closed', { pluginId: left.pluginId });
  }
}

export const nav = new Nav();

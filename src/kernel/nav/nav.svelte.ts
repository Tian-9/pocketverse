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
  /**
   * 弹窗被程序关掉（点背景、保存）：从登记里移除。
   * 不调 history.back()：它是异步的，和紧接着打开的下一个弹窗会打架。
   * 改为把当前这条历史记录标记为"废弃"，下次 push 用 replaceState 复用它，用户按返回时自动跳过它。
   */
  closeOverlay(token: number) {
    const i = this.entries.findIndex((e) => e.token === token);
    if (i < 0) return;
    const wasTop = i === this.entries.length - 1;
    this.entries.splice(i, 1);
    if (wasTop) this.deadTop = true;
  }
  /** 当前历史记录是否已废弃（对应的弹窗已被程序关掉） */
  private deadTop = false;

  private record(kind: HistoryEntry['kind'], close?: () => void): number {
    const token = ++this.token;
    this.entries.push({ token, kind, close });
    if (this.hasHistory) {
      if (this.deadTop) { history.replaceState({ pv: token }, ''); this.deadTop = false; }
      else history.pushState({ pv: token }, '');
    }
    return token;
  }

  private onPop(target: number) {
    const wasDead = this.deadTop;
    this.deadTop = false;
    let popped = 0;
    while (this.entries.length && this.entries[this.entries.length - 1]!.token > target) {
      const en = this.entries.pop()!;
      if (en.kind === 'overlay') en.close?.();
      else this.popScreen();
      popped++;
    }
    // 这一步只是跨过了一条废弃记录，什么都没关：替用户再退一步（桌面上不退，免得退出 app）
    if (wasDead && popped === 0 && this.entries.length && this.hasHistory) { history.back(); return; }
    const w = this.waiters.splice(0);
    for (const r of w) r();
  }

  private popScreen() {
    const left = this.stack.pop();
    if (left && this.stack.length === 0) bus.emit('app.closed', { pluginId: left.pluginId });
  }
}

export const nav = new Nav();

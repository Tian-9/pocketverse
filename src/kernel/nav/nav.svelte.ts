import { bus } from '../bus/bus';

export interface NavEntry { pluginId: string; screen: string; params?: Record<string, unknown> }

/** 简单的界面栈：桌面在底，push 进 App 或子界面，pop 返回。 */
class Nav {
  stack = $state<NavEntry[]>([]);
  top = $derived(this.stack[this.stack.length - 1] ?? null);

  push(pluginId: string, screen: string, params?: Record<string, unknown>) {
    const first = this.stack.length === 0;
    this.stack.push({ pluginId, screen, params });
    if (first) bus.emit('app.opened', { pluginId });
  }
  pop() {
    const left = this.stack.pop();
    if (left && this.stack.length === 0) bus.emit('app.closed', { pluginId: left.pluginId });
  }
  home() {
    const bottom = this.stack[0];
    this.stack = [];
    if (bottom) bus.emit('app.closed', { pluginId: bottom.pluginId });
  }
}

export const nav = new Nav();

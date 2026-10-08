import { liveQuery } from 'dexie';

/**
 * 把 Dexie liveQuery 变成 Svelte 响应式值。只能在组件初始化阶段调用。
 * 查询函数里读到的 Svelte 状态不会被追踪（它在异步里跑），依赖状态的查询要用 deps 显式声明。
 */
export function live<T>(fn: () => Promise<T>, initial: T, deps?: () => unknown[]): { readonly value: T } {
  let value = $state(initial) as T;
  $effect(() => {
    deps?.();
    const sub = liveQuery(fn).subscribe({
      next: (v) => (value = v),
      error: (e) => console.error('[live]', e instanceof Error ? `${e.name}: ${e.message}` : e),
    });
    return () => sub.unsubscribe();
  });
  return {
    get value() {
      return value;
    },
  };
}

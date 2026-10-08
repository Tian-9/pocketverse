import { liveQuery } from 'dexie';

/** 把 Dexie liveQuery 变成 Svelte 响应式值。只能在组件初始化阶段调用。 */
export function live<T>(fn: () => Promise<T>, initial: T): { readonly value: T } {
  let value = $state(initial) as T;
  $effect(() => {
    const sub = liveQuery(fn).subscribe({
      next: (v) => (value = v),
      error: (e) => console.error('[live]', e),
    });
    return () => sub.unsubscribe();
  });
  return {
    get value() {
      return value;
    },
  };
}

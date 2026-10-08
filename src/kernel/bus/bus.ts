import type { KernelEvents } from '../api/types';

type Handler = (payload: any) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on<K extends keyof KernelEvents>(name: K, fn: (p: KernelEvents[K]) => void): () => void;
  on(name: string, fn: Handler): () => void;
  on(name: string, fn: Handler): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof KernelEvents>(name: K, payload: KernelEvents[K]): void;
  emit(name: string, payload: unknown): void;
  emit(name: string, payload: unknown): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus] handler for ${name} threw`, e);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();

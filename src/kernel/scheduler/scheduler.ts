import { bus } from '../bus/bus';

/** 前台调度器：页面不可见时暂停计时，回到前台发 app.resumed 带离开时长。 */
class Scheduler {
  private hiddenAt: number | null = null;
  private timers = new Set<ReturnType<typeof setInterval>>();

  boot() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenAt = Date.now();
        for (const t of this.timers) clearInterval(t);
      } else if (this.hiddenAt !== null) {
        const elapsedMs = Date.now() - this.hiddenAt;
        this.hiddenAt = null;
        bus.emit('app.resumed', { elapsedMs });
      }
    });
  }

  /** 仅前台有效的周期任务；切到后台会被清掉，回到前台由调用方按 app.resumed 重建。 */
  every(ms: number, fn: () => void): () => void {
    const t = setInterval(fn, ms);
    this.timers.add(t);
    return () => {
      clearInterval(t);
      this.timers.delete(t);
    };
  }
}

export const scheduler = new Scheduler();

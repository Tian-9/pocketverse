import { bus } from '../bus/bus';
import { db } from '../storage/db';

/** 前台调度器：页面不可见时暂停计时，回到前台发 app.resumed 带离开时长。 */
class Scheduler {
  private hiddenAt: number | null = null;
  private timers = new Set<ReturnType<typeof setInterval>>();

  async boot() {
    // 冷启动也算"回来"：和上次离开的时间比
    const lastSeen = await db().getKV<number>('kernel.lastSeen', 0);
    if (lastSeen) bus.emit('app.resumed', { elapsedMs: Date.now() - lastSeen });
    const mark = () => db().setKV('kernel.lastSeen', Date.now()).catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenAt = Date.now();
        mark();
        for (const t of this.timers) clearInterval(t);
      } else if (this.hiddenAt !== null) {
        const elapsedMs = Date.now() - this.hiddenAt;
        this.hiddenAt = null;
        bus.emit('app.resumed', { elapsedMs });
      }
    });
    window.addEventListener('pagehide', mark);
    this.every(60_000, mark);
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

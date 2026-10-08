import { bus } from '../bus/bus';
import { db } from '../storage/db';

export type ThemeMode = 'system' | 'light' | 'dark';

/** 主题引擎 M0 版：只管明暗模式。主题包（token 覆盖）M4 再接。 */
class Theme {
  mode = $state<ThemeMode>('system');
  private mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  async boot() {
    this.mode = await db().getKV<ThemeMode>('kernel.theme.mode', 'system');
    this.apply();
    this.mql?.addEventListener('change', () => this.apply());
  }

  async setMode(mode: ThemeMode) {
    this.mode = mode;
    await db().setKV('kernel.theme.mode', mode);
    this.apply();
    bus.emit('theme.changed', { themeId: mode });
  }

  get isDark() {
    return this.mode === 'dark' || (this.mode === 'system' && !!this.mql?.matches);
  }

  private apply() {
    const root = document.documentElement;
    if (this.mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.mode);
    root.classList.toggle('dark-system', !!this.mql?.matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', this.isDark ? '#000000' : '#f2f2f7');
  }
}

export const theme = new Theme();

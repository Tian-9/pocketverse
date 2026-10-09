import type { PluginManifest, Shortcut, PluginContext } from '../api/types';
import { bus } from '../bus/bus';
import { db, pluginTable } from '../storage/db';
import { llm } from '../llm/gateway.svelte';
import { CONSOLIDATE_MODEL } from '../memory/consolidate';
import { nav } from '../nav/nav.svelte';

export interface DockSlot { pluginId: string; shortcutId: string }

/** 快捷方式的全局 id：'<pluginId>/<shortcutId>'，'app' 表示插件主界面。 */
export interface ResolvedShortcut extends Shortcut { pluginId: string; pluginName: string; available: boolean }

class Registry {
  plugins = $state<PluginManifest[]>([]);
  enabled = $state<Record<string, boolean>>({});
  dock = $state<(DockSlot | null)[]>([null, null, null, null]);
  ready = $state(false);

  /** 桌面上显示的插件：有 app 贡献且已启用 */
  apps = $derived(this.plugins.filter((p) => p.app && this.isEnabled(p.id)));

  /** 所有可选快捷方式，含未启用插件的（标 available=false，编辑 Dock 时置灰） */
  shortcuts = $derived.by<ResolvedShortcut[]>(() => {
    const out: ResolvedShortcut[] = [];
    for (const p of this.plugins) {
      const available = this.isEnabled(p.id);
      if (p.app) out.push({ id: 'app', label: p.name, screen: 'app', icon: p.app.icon, pluginId: p.id, pluginName: p.name, available });
      for (const s of p.shortcuts ?? []) {
        if (out.some((x) => x.pluginId === p.id && x.id === s.id)) continue; // 'app' 由内核自动生成，重复声明忽略
        out.push({ ...s, pluginId: p.id, pluginName: p.name, available });
      }
    }
    return out;
  });

  register(manifest: PluginManifest) {
    if (this.plugins.some((p) => p.id === manifest.id)) throw new Error(`插件重复注册: ${manifest.id}`);
    this.plugins.push(manifest);
  }

  get(id: string) {
    return this.plugins.find((p) => p.id === id);
  }

  isEnabled(id: string) {
    const p = this.get(id);
    if (!p) return false;
    return p.core ? true : this.enabled[id] === true;
  }

  /** 从数据库恢复启用状态和 Dock，然后 setup 已启用插件。 */
  async boot(defaults: { enabled: string[]; dock: (DockSlot | null)[] }) {
    const savedEnabled = await db().getKV<Record<string, boolean> | null>('kernel.enabled', null);
    const savedDock = await db().getKV<(DockSlot | null)[] | null>('kernel.dock', null);
    // 老安装也要拿到后来新加的默认插件：没明确开关过的（undefined）按默认来，用户关过的（false）尊重
    const enabled = { ...(savedEnabled ?? {}) };
    let changed = !savedEnabled;
    for (const id of defaults.enabled) if (enabled[id] === undefined) { enabled[id] = true; changed = true; }
    this.enabled = enabled;
    if (changed) await db().setKV('kernel.enabled', enabled);
    this.dock = savedDock ?? defaults.dock;
    for (const p of this.plugins) if (this.isEnabled(p.id)) await this.runSetup(p);
    this.ready = true;
  }

  async setEnabled(id: string, on: boolean) {
    const p = this.get(id);
    if (!p || p.core) return;
    if (this.enabled[id] === on) return;
    this.enabled[id] = on;
    await db().setKV('kernel.enabled', $state.snapshot(this.enabled));
    if (on) {
      await this.runSetup(p);
      bus.emit('plugin.enabled', { pluginId: id });
    } else {
      await p.teardown?.();
      // 插件关掉后，Dock 里指向它的格子清空
      this.dock = this.dock.map((s) => (s?.pluginId === id ? null : s));
      await db().setKV('kernel.dock', $state.snapshot(this.dock));
      bus.emit('plugin.disabled', { pluginId: id });
    }
  }

  async setDock(index: number, slot: DockSlot | null) {
    this.dock[index] = slot;
    await db().setKV('kernel.dock', $state.snapshot(this.dock));
  }

  resolveDock(): (ResolvedShortcut | null)[] {
    return this.dock.map((s) => {
      if (!s) return null;
      const r = this.shortcuts.find((x) => x.pluginId === s.pluginId && x.id === s.shortcutId);
      return r && r.available ? r : null;
    });
  }

  private async runSetup(p: PluginManifest) {
    for (const [name, fn] of Object.entries(p.onEvent ?? {})) if (fn) bus.on(name, fn as any);
    await p.setup?.(makeContext(p.id));
  }
}

function makeContext(id: string): PluginContext {
  return {
    id,
    emit: (name: string, payload: unknown) => bus.emit(name, payload),
    navigate: (screen, params) => nav.push(id, screen, params),
    back: () => nav.pop(),
    notify: (title, body, screen) => bus.emit('notify', { title, body, pluginId: id, screen }),
    settings: {
      get: (key, fallback) => db().getKV(`plugin.${id}.${key}`, fallback),
      set: (key, value) => db().setKV(`plugin.${id}.${key}`, value),
    },
    table: (name) => db().table(pluginTable(id, name)),
    llm: {
      get configured() { return llm.configured; },
      async chat(req) {
        const r = await llm.chat({
          system: [{ type: 'text', text: req.system }],
          messages: [{ role: 'user', content: [{ type: 'text', text: req.user }] }],
          purpose: `plugin:${id}`, maxTokens: req.maxTokens ?? 1024, effort: req.effort ?? 'low',
          ...(req.cheap ? { model: CONSOLIDATE_MODEL } : {}),
        });
        return { text: r.text };
      },
    },
    async activeCampaigns() {
      const since = Date.now() - 7 * 24 * 3600 * 1000;
      const cps = await db().campaigns.where('lastPlayedAt').aboveOrEqual(since).toArray();
      const out = [];
      for (const c of cps) {
        const ch = c.characterIds[0] ? await db().characters.get(c.characterIds[0]) : undefined;
        if (ch) out.push({ campaignId: c.id, characterId: ch.id, characterName: ch.name, lastPlayedAt: c.lastPlayedAt });
      }
      return out;
    },
  };
}

export const registry = new Registry();

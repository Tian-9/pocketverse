import './app.css';
import { registerSW } from 'virtual:pwa-register';
import { bus } from '$kernel/bus/bus';
import { mount } from 'svelte';
import App from './App.svelte';
import { builtinPlugins } from './plugins';
import { registry } from '$kernel/registry/registry.svelte';
import { openDB } from '$kernel/storage/db';
import { theme } from '$kernel/theme/theme.svelte';
import { scheduler } from '$kernel/scheduler/scheduler';
import { nav } from '$kernel/nav/nav.svelte';
import { llm } from '$kernel/llm/gateway.svelte';
import { chat } from '$kernel/chat/engine.svelte';

async function boot() {
  nav.boot();
  for (const p of builtinPlugins) registry.register(p);
  openDB(builtinPlugins);
  await theme.boot();
  await llm.boot();
  await chat.boot();
  await registry.boot({
    enabled: ['moments', 'music'],
    dock: [
      { pluginId: 'chat', shortcutId: 'app' },
      { pluginId: 'characters', shortcutId: 'app' },
      { pluginId: 'lore', shortcutId: 'app' },
      { pluginId: 'settings', shortcutId: 'app' },
    ],
  });
  // 插件都 setup 完再发 app.resumed，否则没人听
  await scheduler.boot();
}

const updateSW = registerSW({
  onNeedRefresh() {
    bus.emit('notify', { title: '有新版本', body: '点这里更新，正在进行的对话不受影响', action: () => updateSW(true) });
  },
});

mount(App, { target: document.getElementById('app')! });
boot().catch((e) => console.error('[boot]', e));

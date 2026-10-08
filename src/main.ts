import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { builtinPlugins } from './plugins';
import { registry } from '$kernel/registry/registry.svelte';
import { openDB } from '$kernel/storage/db';
import { theme } from '$kernel/theme/theme.svelte';
import { scheduler } from '$kernel/scheduler/scheduler';

async function boot() {
  for (const p of builtinPlugins) registry.register(p);
  openDB(builtinPlugins);
  await theme.boot();
  scheduler.boot();
  await registry.boot({
    enabled: ['moments'],
    dock: [
      { pluginId: 'chat', shortcutId: 'app' },
      { pluginId: 'characters', shortcutId: 'app' },
      { pluginId: 'lore', shortcutId: 'app' },
      { pluginId: 'settings', shortcutId: 'app' },
    ],
  });
}

mount(App, { target: document.getElementById('app')! });
boot().catch((e) => console.error('[boot]', e));

import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import Settings from './Settings.svelte';
import Plugins from './Plugins.svelte';
import Appearance from './Appearance.svelte';
import ApiSettings from './ApiSettings.svelte';

export default definePlugin({
  id: 'settings',
  name: '设置',
  version: '0.1.0',
  core: true,
  description: 'API、外观、插件开关。',
  app: { screen: Settings, icon: { paths: icons.gear, background: gradients.gray } },
  screens: { plugins: Plugins, appearance: Appearance, api: ApiSettings },
  shortcuts: [{ id: 'plugins', label: '插件', screen: 'plugins', icon: { paths: icons.plug, background: gradients.black } }],
});

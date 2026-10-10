import { definePlugin, icons, gradients } from '$kernel/api';
import Worlds from './Worlds.svelte';
import Lore from './Lore.svelte';
import LoreEntryEdit from './LoreEntryEdit.svelte';
import Overlays from './Overlays.svelte';

export default definePlugin({
  id: 'lore',
  name: '世界',
  version: '0.3.0',
  core: true,
  description: '世界背景：一个个世界和各自的条目、触发规则、本局变化。',
  app: { screen: Worlds, icon: { paths: icons.book, background: gradients.indigo } },
  // world 是某个世界的条目页；人物背景在角色插件里，不在这里
  screens: { world: Lore, entry: LoreEntryEdit, overlays: Overlays },
});

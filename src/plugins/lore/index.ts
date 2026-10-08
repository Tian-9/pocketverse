import { definePlugin, icons, gradients } from '$kernel/api';
import Lore from './Lore.svelte';
import LoreEntryEdit from './LoreEntryEdit.svelte';
import Overlays from './Overlays.svelte';

export default definePlugin({
  id: 'lore',
  name: '世界书',
  version: '0.2.0',
  core: true,
  description: '世界书条目、触发规则、本局变化。',
  app: { screen: Lore, icon: { paths: icons.book, background: gradients.indigo } },
  screens: { entry: LoreEntryEdit, overlays: Overlays },
});

import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import Lore from './Lore.svelte';

export default definePlugin({
  id: 'lore',
  name: '世界书',
  version: '0.1.0',
  core: true,
  description: '世界书条目与触发规则。',
  app: { screen: Lore, icon: { paths: icons.book, background: gradients.indigo } },
});

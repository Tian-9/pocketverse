import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import Characters from './Characters.svelte';

export default definePlugin({
  id: 'characters',
  name: '角色',
  version: '0.1.0',
  core: true,
  description: '世界与角色管理，导入角色卡。',
  app: { screen: Characters, icon: { paths: icons.person, background: gradients.orange } },
});

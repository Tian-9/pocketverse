import { definePlugin, icons, gradients } from '$kernel/api';
import Characters from './Characters.svelte';
import CharacterDetail from './CharacterDetail.svelte';

export default definePlugin({
  id: 'characters',
  name: '角色',
  version: '0.2.0',
  core: true,
  description: '世界与角色管理，导入角色卡。',
  app: { screen: Characters, icon: { paths: icons.person, background: gradients.orange } },
  screens: { detail: CharacterDetail },
});

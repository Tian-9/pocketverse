import { definePlugin, icons, gradients } from '$kernel/api';
import Characters from './Characters.svelte';
import CharacterDetail from './CharacterDetail.svelte';
import Profile from './Profile.svelte';
import Inspect from './Inspect.svelte';
import Findings from './Findings.svelte';
import BookEntry from './BookEntry.svelte';
import Book from './Book.svelte';
import CharacterLore from './CharacterLore.svelte';

export default definePlugin({
  id: 'characters',
  name: '角色',
  version: '0.2.0',
  core: true,
  description: '世界与角色管理，导入角色卡。',
  app: { screen: Characters, icon: { paths: icons.person, background: gradients.orange } },
  // profile 是角色主页：这一局里的他（状态、钱包、朋友圈、记忆）；detail 是编辑角色卡
  screens: { detail: CharacterDetail, profile: Profile, inspect: Inspect, findings: Findings, book: Book, bookEntry: BookEntry, lore: CharacterLore },
});

import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import ChatList from './ChatList.svelte';

export default definePlugin({
  id: 'chat',
  name: '信息',
  version: '0.1.0',
  core: true,
  description: '和角色对话。内核级，不可关闭。',
  app: { screen: ChatList, icon: { paths: icons.chat, background: gradients.green } },
});

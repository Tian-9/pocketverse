import { definePlugin, icons, gradients } from '$kernel/api';
import ChatList from './ChatList.svelte';
import Conversation from './Conversation.svelte';
import Recall from './Recall.svelte';
import Nudge from './Nudge.svelte';
import { setChatCtx } from './ctx';

export default definePlugin({
  id: 'chat',
  name: '信息',
  version: '0.2.0',
  core: true,
  description: '和角色对话。内核级，不可关闭。',
  app: { screen: ChatList, icon: { paths: icons.chat, background: gradients.green } },
  screens: { conversation: Conversation },
  // 消息事件：不是卡片，是一行小灰字，发出去他照常回复
  composerActions: [
    { id: 'recall', label: '撤回', icon: { paths: icons.recall, background: gradients.gray }, component: Recall },
    { id: 'nudge', label: '拍一拍', icon: { paths: icons.nudge, background: gradients.yellow }, component: Nudge },
  ],
  setup(c) { setChatCtx(c); },
});

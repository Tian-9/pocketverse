import { definePlugin, icons, gradients } from '$kernel/api';
import SceneList from './SceneList.svelte';

/** 「线下」桌面图标：列出每个角色的线下会话。会话本身还是聊天插件渲染（conversation 屏），只是入口分开 */
export default definePlugin({
  id: 'scene',
  name: '线下',
  version: '0.1.0',
  core: true,
  description: '和角色面对面推剧情。内核级，不可关闭。',
  app: { screen: SceneList, icon: { paths: icons.meet, background: gradients.indigo } },
});

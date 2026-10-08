import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import Moments from './Moments.svelte';

/** 示例插件：朋友圈。M3 实现内容，这里先验证贡献点能被内核收集和展示。 */
export default definePlugin({
  id: 'moments',
  name: '朋友圈',
  version: '0.1.0',
  description: '角色按时间线发动态，可点赞评论，内容注入提示词。',
  app: { screen: Moments, icon: { paths: icons.clock, background: gradients.yellow } },
  promptContributors: [{ id: 'recent-moments' }],
  outputHandlers: [{ tag: 'moment', component: Moments }],
  storage: { tables: { posts: 'id, campaignId, characterId, createdAt' } },
  setup(ctx) {
    ctx.notify('朋友圈已开启', '桌面多了一个图标，Dock 候选项也更新了。');
  },
});

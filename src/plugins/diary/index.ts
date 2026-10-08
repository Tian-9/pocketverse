import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import Diary from './Diary.svelte';

export default definePlugin({
  id: 'diary',
  name: '日记',
  version: '0.1.0',
  description: '每天结束后让角色写一篇日记，作为长期记忆来源。',
  app: { screen: Diary, icon: { paths: icons.diary, background: gradients.pink } },
  promptContributors: [{ id: 'recent-diary' }],
  tools: [{ name: 'diary.read', description: '读取某天的日记', inputSchema: {}, handler: async () => null }],
  storage: { tables: { entries: 'id, campaignId, characterId, date' } },
});

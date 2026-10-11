<script lang="ts">
  /** 角色主页上的论坛段：这一局里他最近一帖，点进论坛 */
  import { List, Cell, live, nav } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { forumApi, storyAt, type Thread } from './index';
  let { campaignId, characterId }: ProfileSectionProps = $props();
  const latest = live(
    () => forumApi.threads().where('campaignId').equals(campaignId).filter((t) => t.author.kind === 'char' && t.author.characterId === characterId).reverse().sortBy('createdAt').then((xs) => xs[0]),
    undefined as Thread | undefined,
    () => [campaignId, characterId],
  );
  const when = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  async function open() {
    await forumApi.setLastCampaign(campaignId);
    nav.push('forum', latest.value ? 'thread' : 'app', latest.value ? { id: latest.value.id } : undefined);
  }
</script>

<List>
  <Cell title="论坛" subtitle={latest.value ? `${when(storyAt(latest.value))} · ${latest.value.title}` : '还没在论坛发过帖'} chevron onclick={open} />
</List>

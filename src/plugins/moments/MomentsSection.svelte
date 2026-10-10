<script lang="ts">
  /** 角色主页上的朋友圈段：这一局里他最近一条动态，点进朋友圈 */
  import { List, Cell } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { momentsApi, type Post } from './index';
  let { campaignId, characterId }: ProfileSectionProps = $props();
  const latest = live(
    () => momentsApi.posts().where('campaignId').equals(campaignId).filter((p) => p.characterId === characterId).reverse().sortBy('createdAt').then((xs) => xs[0]),
    undefined as Post | undefined,
    () => [campaignId, characterId],
  );
  const when = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
</script>

<List>
  <Cell title="朋友圈" subtitle={latest.value ? `${when(latest.value.createdAt)} · ${latest.value.text}` : '还没发过动态'} chevron onclick={() => nav.push('moments', 'app')} />
</List>

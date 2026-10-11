<script lang="ts">
  /** 主页「他今天」：按这局的钟列今天的安排，点进日历 */
  import { List, Cell, live, nav, clock } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { calendarApi, type CalendarEvent } from './index';
  let { campaignId, characterId }: ProfileSectionProps = $props();
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const today = live(
    async () => { const cp = await calendarApi.ctx().data.campaign(campaignId); return cp ? (await calendarApi.today(campaignId, cp.now)).filter((e) => e.owner === characterId) : []; },
    [] as CalendarEvent[],
    () => [campaignId, characterId],
  );
  const open = () => nav.push('calendar', 'app', { campaignId });
</script>

<List>
  {#if today.value.length}
    {#each today.value.slice(0, 3) as e (e.id)}
      <Cell title={e.title} subtitle={`${fmt(e.start)}${e.end ? '–' + fmt(e.end) : ''}${e.place ? ' · ' + e.place : ''}${e.status === 'done' ? ' · 做了' : e.status === 'skipped' ? ' · 没去' : ''}`} chevron onclick={open} />
    {/each}
    {#if today.value.length > 3}<Cell title={`还有 ${today.value.length - 3} 件`} chevron onclick={open} />{/if}
  {:else}
    <Cell title="今天没有安排" subtitle="打开日历给他排一周" chevron onclick={open} />
  {/if}
</List>

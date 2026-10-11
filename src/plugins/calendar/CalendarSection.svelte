<script lang="ts">
  /** 主页「他今天」：按这局的钟列今天的安排，点进日历 */
  import { List, Cell, live, nav, clock } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { calendarApi, type CalendarEvent } from './index';
  let { campaignId, characterId }: ProfileSectionProps = $props();
  const today = live(
    async () => { const cp = await calendarApi.ctx().data.campaign(campaignId); return cp ? { tz: cp.timeZone, events: (await calendarApi.today(campaignId, cp.now)).filter((e) => e.owner === characterId) } : { tz: undefined, events: [] }; },
    { tz: undefined as string | undefined, events: [] as CalendarEvent[] },
    () => [campaignId, characterId],
  );
  const fmt = (ts: number) => clock.formatTime(ts, today.value.tz);
  const open = () => nav.push('calendar', 'app', { campaignId });
</script>

<List>
  {#if today.value.events.length}
    {#each today.value.events.slice(0, 3) as e (e.id)}
      <Cell title={e.title} subtitle={`${fmt(e.start)}${e.end ? '–' + fmt(e.end) : ''}${e.place ? ' · ' + e.place : ''}${e.status === 'done' ? ' · 做了' : e.status === 'skipped' ? ' · 没去' : ''}`} chevron onclick={open} />
    {/each}
    {#if today.value.events.length > 3}<Cell title={`还有 ${today.value.events.length - 3} 件`} chevron onclick={open} />{/if}
  {:else}
    <Cell title="今天没有安排" subtitle="打开日历给他排一周" chevron onclick={open} />
  {/if}
</List>

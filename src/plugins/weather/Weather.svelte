<script lang="ts">
  /**
   * 天气 App：你那边的现在和这几天；选了别的城市的角色，他那边也列一行。
   * 位置在设置里改（和名字一起），这里只是入口。
   */
  import { NavBar, List, Cell, SectionTitle, Placeholder, Glyph, nav, live, places, icons, gradients } from '$kernel/api';
  import type { Place, CharacterView } from '$kernel/api';
  import { fetchWeather, type Weather } from './lookup';
  import { weatherApi } from './index';

  const place = live(() => places.user(), places.DEFAULT_USER_PLACE);
  const chars = live(() => weatherApi.ctx().data.characters(), [] as CharacterView[]);
  let w = $state<Weather | null>(null);
  let others = $state<{ ch: CharacterView; w: Weather | null }[]>([]);
  let loading = $state(false), failed = $state(false);
  let seq = 0;

  async function load(p: Place, force = false) {
    const my = ++seq;
    loading = true; failed = false;
    const r = await fetchWeather(p, fetch, Date.now(), force);
    if (my !== seq) return;
    w = r; failed = !r; loading = false;
    // 他们那边：选了别的城市的角色，每个城市一行
    const away = chars.value.filter((c) => c.place && !places.samePlace(c.place, p));
    others = await Promise.all(away.map(async (ch) => ({ ch, w: await fetchWeather(ch.place!, fetch, Date.now(), force) })));
  }
  $effect(() => { const p = place.value; chars.value; load(p); });
  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayLabel = (date: string, i: number) => (i === 0 ? '今天' : i === 1 ? '明天' : WD[new Date(date + 'T00:00').getDay()]);
  const updated = $derived(w ? new Date(w.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
</script>

<NavBar title="天气" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => load(place.value, true)} aria-label="刷新" disabled={loading}><Glyph paths={icons.refresh} size={22} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if w}
  <div class="hero">
    <div class="city">{w.place}</div>
    <div class="temp">{w.temp}°</div>
    <div class="desc">{w.desc} · 体感 {w.feels}°</div>
    <div class="meta">湿度 {w.humidity}% · {w.windDir}风 {w.windLevel} 级{w.daily[0]?.sunrise ? ` · 日出 ${w.daily[0].sunrise} 日落 ${w.daily[0].sunset}` : ''}</div>
  </div>
  <List>
    {#each w.daily.slice(0, 5) as d, i (d.date)}
      <Cell title={dayLabel(d.date, i) ?? d.date} subtitle={d.precip >= 30 ? `降水概率 ${d.precip}%` : undefined} value={`${d.desc}  ${d.min}° / ${d.max}°`} />
    {/each}
  </List>
{:else if loading}
  <Placeholder title="查天气中…" paths={icons.weather} />
{:else if failed}
  <Placeholder title="查不到天气" body="没网，或天气接口不通。右上角可以重试。" paths={icons.weather} />
{/if}

{#if others.length}
  <SectionTitle text="他们那边" />
  <List footer="选了别的城市的角色。他们聊天时知道自己那边的天气，也知道你这边的。">
    {#each others as o (o.ch.id)}
      <Cell title={o.ch.name} subtitle={o.ch.place?.name} value={o.w ? `${o.w.desc} ${o.w.temp}°` : '查不到'} />
    {/each}
  </List>
{/if}

<SectionTitle text="地点" />
<List footer={`这里的天气会出现在聊天里（只在这局的时间和真实时间对齐时）。${updated ? `上次更新 ${updated}。` : ''}`}>
  <Cell title="你在哪座城市" value={place.value.name} icon={{ paths: icons.pin, background: gradients.red }} chevron onclick={() => nav.push('settings', 'api')} />
</List>
<div style="height:40px"></div>

<style>
  .hero { text-align: center; padding: 8px 16px 20px; }
  .city { font-size: 22px; font-weight: 600; color: var(--label); }
  .temp { font-size: 72px; font-weight: 200; line-height: 1.1; color: var(--label); font-variant-numeric: tabular-nums; }
  .desc { font-size: 17px; color: var(--label); }
  .meta { font-size: 13px; color: var(--label-2); margin-top: 4px; }
  .iconbtn { padding: 6px; display: flex; }
</style>

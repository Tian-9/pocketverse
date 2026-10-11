<script lang="ts">
  /**
   * 日历 App：一局一本。月视图（有事的日子打点，剧情「今天」高亮）→ 点一天看列表 → 点一条改 / 删 / 标做没做。
   * 「+」手填；「排一周」让便宜模型给他排；某一天能「在聊天里推进到这天」。
   */
  import { NavBar, Placeholder, Glyph, Sheet, List, Cell, Field, Button, Toggle, live, nav, clock, icons } from '$kernel/api';
  import type { CampaignView } from '$kernel/api';
  import { calendarApi, dayRange, type CalendarEvent } from './index';

  let { campaignId: initial }: { campaignId?: string } = $props();
  const campaigns = live(() => calendarApi.ctx().data.currentCampaigns(), []);
  let selected = $state<string | null>(null);
  $effect(() => {
    const list = campaigns.value;
    if (!list.length) { selected = null; return; }
    if (selected && list.some((c) => c.id === selected)) return;
    if (initial && list.some((c) => c.id === initial)) { selected = initial; return; }
    calendarApi.lastCampaign().then((last) => { selected = list.some((c) => c.id === last) ? last : list[0]!.id; });
  });
  const current = $derived<CampaignView | undefined>(campaigns.value.find((c) => c.id === selected));
  // 这局的「今天」按它的钟，「哪一天」「几点」按他的时区
  const tz = $derived(current?.timeZone);
  const todayKey = $derived(current ? clock.dateKey(current.now, tz) : clock.dateKey(Date.now()));
  let day = $state<string | null>(null);
  let month = $state<string | null>(null); // YYYY-MM
  $effect(() => { if (current && day === null) { day = todayKey; month = todayKey.slice(0, 7); } });

  const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y! + 1}-01` : `${y}-${String(mo! + 1).padStart(2, '0')}`; };
  const monthRange = (m: string, z?: string): [number, number] => [clock.zoned(m + '-01', '00:00', z), clock.zoned(nextMonth(m) + '-01', '00:00', z)];
  const monthEvents = live(() => (selected && month ? calendarApi.between(selected, ...monthRange(month, tz)) : Promise.resolve([] as CalendarEvent[])), [] as CalendarEvent[], () => [selected, month, tz]);
  const dayEvents = $derived.by(() => { if (!day) return []; const [s, e] = dayRange(day, tz); return monthEvents.value.filter((x) => x.start >= s && x.start < e); });
  const dotted = $derived(new Set(monthEvents.value.map((e) => clock.dateKey(e.start, tz))));
  const grid = $derived.by(() => {
    if (!month) return [] as (string | null)[];
    const [y, mo] = month.split('-').map(Number);
    const first = new Date(y!, mo! - 1, 1), count = new Date(y!, mo!, 0).getDate();
    const cells: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= count; d++) cells.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    return cells;
  });
  const monthTitle = $derived(month ? `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月` : '');
  function shiftMonth(n: number) {
    if (!month) return;
    const [y, mo] = month.split('-').map(Number);
    const d = new Date(y!, mo! - 1 + n, 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function goToday() { day = todayKey; month = todayKey.slice(0, 7); }
  const fmt = (ts: number) => clock.formatTime(ts, tz);
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const dayTitle = (k: string) => `${Number(k.slice(5, 7))} 月 ${Number(k.slice(8))} 日 周${WEEK[new Date(k + 'T00:00').getDay()]}`;
  const who = (e: CalendarEvent) => (e.owner === 'user' ? '你' : current?.characterName ?? '他');

  // ---- 排一周 ----
  let busy = $state(false);
  let notice = $state('');
  async function plan() {
    const cp = current; if (!cp || busy) return;
    if (!calendarApi.ctx().llm.configured) { calendarApi.ctx().notify('排不了', '先在设置里配置 API Key'); return; }
    busy = true; notice = '正在给他排一周…';
    try {
      const r = await calendarApi.planWeek(cp.id, cp.characterId, cp.now);
      notice = r ? (r.length ? `排了 ${r.length} 件` : '这次没排出来') : '';
    } catch (e) { calendarApi.ctx().notify('排日程失败', e instanceof Error ? e.message : String(e)); notice = ''; }
    finally { busy = false; setTimeout(() => (notice = ''), 4000); }
  }

  // ---- 新建 / 编辑 ----
  let editing = $state<Partial<CalendarEvent> | null>(null);
  let f = $state({ title: '', date: '', start: '', end: '', place: '', note: '', mine: false });
  const dateOf = (ts: number) => clock.dateKey(ts, tz);
  function openNew() {
    editing = {};
    f = { title: '', date: day ?? todayKey, start: '09:00', end: '', place: '', note: '', mine: false };
  }
  function openEdit(e: CalendarEvent) {
    editing = e;
    f = { title: e.title, date: dateOf(e.start), start: fmt(e.start), end: e.end ? fmt(e.end) : '', place: e.place ?? '', note: e.note ?? '', mine: e.owner === 'user' };
  }
  async function save() {
    const cp = current; if (!cp || !editing) return;
    const title = f.title.trim(); if (!title || !f.date || !f.start) return;
    const start = clock.zoned(f.date, f.start, tz);
    const end = f.end ? clock.zoned(f.date, f.end, tz) : NaN;
    const patch: Partial<CalendarEvent> = { title, start, end: Number.isFinite(end) && end > start ? end : undefined, place: f.place.trim() || undefined, note: f.note.trim() || undefined, owner: f.mine ? 'user' : cp.characterId };
    if (editing.id) await calendarApi.update(editing.id, patch);
    else await calendarApi.add({ campaignId: cp.id, owner: patch.owner!, start, end: patch.end, title, place: patch.place, note: patch.note, source: 'manual', ...(f.mine ? {} : { status: 'planned' }) });
    day = f.date; month = f.date.slice(0, 7);
    editing = null;
  }
  async function remove() { if (editing?.id) await calendarApi.remove(editing.id); editing = null; }
  async function mark(status: CalendarEvent['status']) { if (editing?.id) await calendarApi.update(editing.id, { status }); editing = null; }

  // 推进到这天：带着时刻去聊天页，那边会打开推进面板
  function skipToDay() {
    const cp = current; if (!cp || !day) return;
    const first = dayEvents.find((e) => e.start > cp.now);
    const ts = first ? first.start : clock.zoned(day, '09:00', tz);
    nav.push('chat', 'conversation', { campaignId: cp.id, skipTo: ts });
  }
  let picking = $state(false);
  async function pick(c: CampaignView) { selected = c.id; day = null; picking = false; await calendarApi.setLastCampaign(c.id); }
</script>

<NavBar title="日历" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={openNew} aria-label="新建安排" disabled={!current}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if !campaigns.value.length}
  <Placeholder title="还没有角色" body="先在「角色」里建一个，他的日历就在这里。" paths={icons.calendar} />
{:else if current}
  <button class="who" onclick={() => (picking = true)}>{current.characterName} · {current.worldName}{campaigns.value.length > 1 ? ' ›' : ''}</button>
  <div class="month">
    <button onclick={() => shiftMonth(-1)} aria-label="上个月">‹</button>
    <button class="title" onclick={goToday}>{monthTitle}</button>
    <button onclick={() => shiftMonth(1)} aria-label="下个月">›</button>
  </div>
  <div class="grid">
    {#each WEEK as w (w)}<div class="wd">{w}</div>{/each}
    {#each grid as k, i (i)}
      {#if k}
        <button class="cell" class:today={k === todayKey} class:on={k === day} onclick={() => (day = k)}>
          <span>{Number(k.slice(8))}</span>{#if dotted.has(k)}<i></i>{/if}
        </button>
      {:else}<div></div>{/if}
    {/each}
  </div>
  {#if day}
    <div class="dayhead"><span>{dayTitle(day)}{day === todayKey ? ' · 今天' : ''}</span></div>
    {#if dayEvents.length}
      <List>
        {#each dayEvents as e (e.id)}
          <Cell title={`${e.title}${e.together ? ' · 一起' : ''}`} subtitle={`${who(e)} · ${fmt(e.start)}${e.end ? '–' + fmt(e.end) : ''}${e.place ? ' · ' + e.place : ''}${e.status === 'done' ? ' · 做了' : e.status === 'skipped' ? ' · 没去' : ''}${e.note ? '\n' + e.note : ''}`} chevron onclick={() => openEdit(e)} />
        {/each}
      </List>
    {:else}
      <p class="empty">这天没有安排</p>
    {/if}
  {/if}
  {#if notice}<p class="notice">{notice}</p>{/if}
  <div class="actions">
    <Button kind="tinted" onclick={plan} disabled={busy}>{busy ? '排着呢…' : '给他排一周'}</Button>
    {#if day && day > todayKey}<Button kind="plain" onclick={skipToDay}>在聊天里推进到这天</Button>{/if}
  </div>
  <p class="hint">他聊天时知道今天的安排。往后不足 3 天没排时，聊天时会自动补一周；你离开一阵或推进时间，他会把过去的安排过完。</p>
{/if}
<div style="height:40px"></div>

<Sheet open={!!editing} onclose={() => (editing = null)} title={editing?.id ? '这件事' : '新安排'}>
  {#if editing}
    <List>
      <Field label="事" bind:value={f.title} placeholder="短一点，像日历里的一行" />
      <Field label="日期" type="date" bind:value={f.date} />
      <Field label="开始" type="time" bind:value={f.start} />
      <Field label="结束" type="time" bind:value={f.end} />
      <Field label="地点" bind:value={f.place} placeholder="可空" />
      <Cell title="我自己的" subtitle={f.mine ? '记在你的日历上，他能看见' : '记在他的日历上'}>{#snippet right()}<Toggle bind:checked={f.mine} label="我自己的" />{/snippet}</Cell>
      <Field multiline rows={2} bind:value={f.note} placeholder="备注，可空" />
    </List>
    <div class="actions">
      <Button onclick={save}>保存</Button>
      {#if editing.id && !f.mine}
        <Button kind="plain" onclick={() => mark(editing?.status === 'done' ? 'planned' : 'done')}>{editing.status === 'done' ? '标成还没做' : '标成做了'}</Button>
      {/if}
      {#if editing.id}<Button kind="plain" onclick={remove}><span style="color:var(--red)">删除</span></Button>{/if}
    </div>
  {/if}
</Sheet>
<Sheet bind:open={picking} title="谁的日历">
  <List>
    {#each campaigns.value as c (c.id)}<Cell title={c.characterName} subtitle={c.worldName} onclick={() => pick(c)} />{/each}
  </List>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .who { display: block; margin: 0 auto 8px; font-size: 13px; color: var(--tint); }
  .month { display: flex; align-items: center; justify-content: space-between; margin: 0 16px; }
  .month button { padding: 6px 12px; font-size: 17px; color: var(--tint); }
  .month .title { font-weight: 600; color: var(--label); }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin: 4px 12px 8px; }
  .wd { text-align: center; font-size: 11px; color: var(--label-3); padding: 4px 0; }
  .cell { position: relative; height: 40px; border-radius: 10px; display: grid; place-items: center; font-size: 15px; color: var(--label); }
  .cell.today span { color: var(--tint); font-weight: 600; }
  .cell.on { background: var(--tint); }
  .cell.on span { color: var(--tint-fg); }
  .cell i { position: absolute; bottom: 4px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--tint); }
  .cell.on i { background: var(--tint-fg); }
  .dayhead { margin: 8px 24px 0; font-size: 13px; color: var(--label-2); }
  .empty, .hint, .notice { margin: 8px 24px; font-size: 13px; color: var(--label-2); }
  .notice { color: var(--tint); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 16px 16px 0; align-items: center; }
</style>

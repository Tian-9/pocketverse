<script lang="ts">
  /** 本地日志：最近的记录，按时间倒序；可复制全部、清空。 */
  import { NavBar, List } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { log, fmt } from '$kernel/log/log';
  const rows = live(() => db().logs.orderBy('ts').reverse().limit(300).toArray(), []);
  let filter = $state<'all' | 'warn' | 'consolidate' | 'llm'>('all');
  const shown = $derived(rows.value.filter((r) => filter === 'all' ? true : filter === 'warn' ? r.level !== 'info' : r.tag === filter));
  let open = $state<Record<string, boolean>>({});
  let copied = $state('');
  async function copyAll() {
    try { await navigator.clipboard.writeText(await log.dump()); copied = '已复制全部日志'; }
    catch { copied = '复制失败，浏览器不允许'; }
    setTimeout(() => (copied = ''), 2000);
  }
  const time = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
</script>

<NavBar title="日志" back="设置" />
<div class="seg">
  {#each [['all', '全部'], ['warn', '问题'], ['consolidate', '记忆整理'], ['llm', '请求']] as [id, label] (id)}
    <button class:on={filter === id} onclick={() => (filter = id as typeof filter)}>{label}</button>
  {/each}
</div>
<div class="actions">
  <button class="act" onclick={copyAll}>复制全部</button>
  <button class="act danger" onclick={() => log.clear()}>清空</button>
</div>
{#if copied}<p class="hint">{copied}</p>{/if}
<List footer={shown.length ? `最近 ${shown.length} 条，点一条看详情` : '还没有日志'}>
  {#each shown as r (r.id)}
    <button class="logrow {r.level}" onclick={() => (open[r.id] = !open[r.id])}>
      <div class="head"><span class="tag">{r.tag}</span><span class="t">{time(r.ts)}</span></div>
      <div class="msg">{r.message}</div>
      {#if open[r.id] && r.data}<pre class="data">{JSON.stringify(r.data, null, 1)}</pre>{/if}
    </button>
  {/each}
</List>
<div style="height:40px"></div>

<style>
  .seg { display: flex; gap: 4px; margin: 8px 16px 0; padding: 4px; background: var(--fill-2); border-radius: 10px; }
  .seg button { flex: 1; padding: 6px; border-radius: 8px; font-size: 13px; color: var(--label); }
  .seg button.on { background: var(--bg-surface); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .actions { display: flex; gap: 8px; margin: 10px 16px 0; }
  .act { flex: 1; padding: 9px; border-radius: 10px; font-size: 15px; font-weight: 600; color: var(--tint); background: var(--fill-2); white-space: nowrap; }
  .act.danger { flex: 0 0 auto; padding: 9px 18px; color: var(--red); }
  .hint { margin: 6px 16px 0; text-align: center; font-size: 13px; color: var(--label-2); }
  .logrow { display: block; width: 100%; text-align: left; padding: 8px 16px; border-bottom: 0.5px solid var(--separator); color: var(--label); background: transparent; }
  .logrow:last-child { border-bottom: none; }
  .head { display: flex; justify-content: space-between; font-size: 12px; color: var(--label-2); }
  .tag { font-weight: 600; }
  .warn .tag { color: var(--orange); }
  .error .tag { color: var(--red); }
  .msg { font-size: 14px; line-height: 1.35; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  .data { margin: 6px 0 0; font-size: 11px; line-height: 1.3; color: var(--label-2); white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, Menlo, monospace; }
</style>

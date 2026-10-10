<script lang="ts">
  /**
   * 原始流：把和 Anthropic 之间的通信原样摆出来看。
   * 每次请求一组：先是发出去的信封（结构摘要，正文只记长度），
   * 然后是服务端流回来的每一个 SSE 事件，未加工。
   */
  import { NavBar, List } from '$kernel/api';
  import { rawlog, type RawEntry } from '$kernel/llm/rawlog.svelte';

  interface Group { key: number; req: RawEntry | null; events: RawEntry[] }
  const groups = $derived.by(() => {
    const out: Group[] = [];
    for (const e of rawlog.entries) {
      if (e.kind === 'request' || out.length === 0) {
        out.push({ key: e.id, req: e.kind === 'request' ? e : null, events: e.kind === 'request' ? [] : [e] });
      } else {
        out[out.length - 1]!.events.push(e);
      }
    }
    return out.reverse();
  });
  let openGroups = $state<Record<number, boolean>>({});
  let openRows = $state<Record<number, boolean>>({});
  const groupOpen = (g: Group, i: number) => openGroups[g.key] ?? i === 0;

  const time = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
  const get = (d: unknown, k: string): unknown => (d && typeof d === 'object' ? (d as Record<string, unknown>)[k] : undefined);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' ? String(v) : '');

  /** 一行摘要：事件类型 + 看得懂的内容 */
  function line(e: RawEntry): { label: string; detail: string; cls: string } {
    if (e.kind === 'done') return { label: '✓ 本条回复收齐', detail: `stop_reason: ${str(get(e.data, 'stop_reason'))}　块：${(get(e.data, 'content') as string[] | undefined)?.join('、') ?? ''}`, cls: 'meta' };
    if (e.kind === 'error') return { label: '✕ 出错', detail: str(get(e.data, 'message')), cls: 'error' };
    const t = str(get(e.data, 'type'));
    if (t === 'message_start') return { label: t, detail: `model: ${str(get(get(e.data, 'message'), 'model'))}`, cls: 'meta' };
    if (t === 'content_block_start') {
      const b = get(e.data, 'content_block');
      const name = str(get(b, 'name'));
      return { label: t, detail: `块 #${num(get(e.data, 'index'))} 开始 → ${str(get(b, 'type'))}${name ? `（${name}）` : ''}`, cls: 'block' };
    }
    if (t === 'content_block_delta') {
      const d = get(e.data, 'delta');
      const dt = str(get(d, 'type'));
      if (dt === 'text_delta') return { label: dt, detail: JSON.stringify(str(get(d, 'text'))), cls: 'text' };
      if (dt === 'input_json_delta') return { label: dt, detail: str(get(d, 'partial_json')) || '""', cls: 'json' };
      if (dt === 'thinking_delta') return { label: dt, detail: JSON.stringify(str(get(d, 'thinking'))), cls: 'think' };
      return { label: dt || t, detail: dt === 'signature_delta' ? '（思考块签名）' : '', cls: 'meta' };
    }
    if (t === 'content_block_stop') return { label: t, detail: `块 #${num(get(e.data, 'index'))} 结束`, cls: 'block' };
    if (t === 'message_delta') {
      const sr = str(get(get(e.data, 'delta'), 'stop_reason'));
      return { label: t, detail: `stop_reason: ${sr}　output_tokens: ${num(get(get(e.data, 'usage'), 'output_tokens'))}`, cls: 'meta' };
    }
    if (t === 'message_stop') return { label: t, detail: '这条回复的流到此为止', cls: 'meta' };
    return { label: t || e.kind, detail: '', cls: 'meta' };
  }

  /** 没配 Key 也能看：回放一条假流（内容是编的，形状和真的一样） */
  function demo() {
    rawlog.request({
      model: 'claude-opus-5-5', max_tokens: 4096,
      thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01', 'context-management-2025-06-27'], fallbacks: 'default',
      context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
      tools: ['lore_search', 'lore_read', 'memory_search', 'memory_recent', 'state_update', 'overlay_write', 'memory_20250818'],
      system: [{ 字数: 386 }, { 字数: 1874, cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', blocks: ['text(14 字)'] },
        { role: 'assistant', blocks: ['text(31 字)'] },
        { role: 'user', blocks: ['text(9 字) ⟨缓存断点⟩', 'text(86 字)'] },
      ],
    }, '示例');
    const evs: unknown[] = [
      { type: 'message_start', message: { id: 'msg_demo', model: 'claude-opus-5-5', role: 'assistant', content: [], usage: { input_tokens: 143, cache_read_input_tokens: 2108, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '等我' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '想想，' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '翻下之前的记忆' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_demo', name: 'memory_search', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query"' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ': "上次吵架' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' 和好"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 52 } },
      { type: 'message_stop' },
    ];
    for (const ev of evs) rawlog.event(ev);
    rawlog.done({ stop_reason: 'tool_use', model: 'claude-opus-5-5', content: ['text', 'tool_use: memory_search'], usage: { input_tokens: 143, output_tokens: 52, cache_read_input_tokens: 2108, cache_creation_input_tokens: 0 } });
  }
</script>

<NavBar title="原始流" back="设置" />
<p class="intro">
  这里是和 Anthropic 之间的原始通信。每次请求一组：第一条是发出去的<b>信封</b>（结构摘要，聊天正文只记字数不记内容），后面是服务端流回来的每一个 <b>SSE 事件</b>，原样未加工。
  text_delta 的切片只是网络分批，切在哪没有含义；tool_use 块的 JSON 是在受限通道里生成的。一轮带查资料的聊天会出现多组——每次工具往返都是一次新请求。
</p>
<div class="actions">
  <button class="act" onclick={demo}>示例回放</button>
  <button class="act danger" onclick={() => rawlog.clear()}>清空</button>
</div>
<List footer={groups.length ? `${groups.length} 次请求，点信封或事件看完整 JSON；刷新页面即清空。` : '还没有记录。聊一句天再回来，或点「示例回放」看一条假流。'}>
  {#each groups as g, i (g.key)}
    <div class="group">
      <button class="ghead" onclick={() => (openGroups[g.key] = !groupOpen(g, i))}>
        <span class="arrow">{groupOpen(g, i) ? '▾' : '▸'}</span>
        <span class="gtitle">请求 · {g.req?.purpose ?? '？'}</span>
        <span class="t">{time((g.req ?? g.events[0]!).ts)} · {g.events.length} 个事件</span>
      </button>
      {#if groupOpen(g, i)}
        {#if g.req}
          <button class="row envelope" onclick={() => (openRows[g.req!.id] = !openRows[g.req!.id])}>
            <span class="badge env">信封 ↑</span>
            <span class="detail">{(get(g.req.data, 'tools') as string[] | undefined)?.length ?? 0} 个工具 · {(get(g.req.data, 'system') as unknown[] | undefined)?.length ?? 0} 个 system 块 · {(get(g.req.data, 'messages') as unknown[] | undefined)?.length ?? 0} 条消息</span>
          </button>
          {#if openRows[g.req.id]}<pre class="data">{JSON.stringify(g.req.data, null, 1)}</pre>{/if}
        {/if}
        {#each g.events as e (e.id)}
          {@const l = line(e)}
          <button class="row" onclick={() => (openRows[e.id] = !openRows[e.id])}>
            <span class="badge {l.cls}">{l.label}</span>
            <span class="detail">{l.detail}</span>
          </button>
          {#if openRows[e.id]}<pre class="data">{JSON.stringify(e.data, null, 1)}</pre>{/if}
        {/each}
      {/if}
    </div>
  {/each}
</List>
<div style="height:40px"></div>

<style>
  .intro { margin: 8px 16px 0; font-size: 13px; line-height: 1.5; color: var(--label-2); }
  .actions { display: flex; gap: 8px; margin: 10px 16px 0; }
  .act { flex: 1; padding: 9px; border-radius: 10px; font-size: 15px; font-weight: 600; color: var(--tint); background: var(--fill-2); }
  .act.danger { flex: 0 0 auto; padding: 9px 18px; color: var(--red); }
  .group { border-bottom: 0.5px solid var(--separator); }
  .group:last-child { border-bottom: none; }
  .ghead { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; padding: 10px 16px; background: transparent; color: var(--label); }
  .arrow { font-size: 11px; color: var(--label-3); width: 12px; }
  .gtitle { font-size: 14px; font-weight: 600; }
  .t { margin-left: auto; font-size: 12px; color: var(--label-2); }
  .row { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left; padding: 4px 16px 4px 34px; background: transparent; }
  .row.envelope { padding-top: 6px; }
  .badge { flex: 0 0 auto; font-size: 11px; font-weight: 600; font-family: ui-monospace, Menlo, monospace; padding: 1px 6px; border-radius: 5px; background: var(--fill-2); color: var(--label-2); }
  .badge.env { color: var(--tint); }
  .badge.text { color: var(--green); }
  .badge.json { color: var(--orange); }
  .badge.think { color: var(--purple); }
  .badge.block { color: var(--indigo); }
  .badge.error { color: var(--red); }
  .detail { font-size: 12px; line-height: 1.45; color: var(--label); font-family: ui-monospace, Menlo, monospace; word-break: break-all; white-space: pre-wrap; }
  .data { margin: 2px 16px 6px 34px; padding: 8px; border-radius: 8px; background: var(--fill-2); font-size: 11px; line-height: 1.35; color: var(--label-2); white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, Menlo, monospace; }
</style>

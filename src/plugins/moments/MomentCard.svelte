<script lang="ts">
  /** 聊天里渲染 <moment> 标签的卡片 */
  import { Glyph, icons } from '$kernel/api';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
</script>

<div class="card">
  <span class="k"><Glyph paths={icons.clock} size={13} width={2.2} /> 发了一条朋友圈</span>
  <p>{body}</p>
</div>

<style>
  .card { background: var(--bg-surface); border: 0.5px solid var(--separator); border-radius: 14px; padding: 10px 12px; max-width: 260px; }
  .k { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--orange); font-weight: 600; letter-spacing: 0.02em; }
  p { margin: 4px 0 0; font-size: 15px; line-height: 1.4; white-space: pre-wrap; }
</style>

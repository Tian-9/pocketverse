<script lang="ts">
  /** 发送前预览：全屏，确认才发 */
  import { gate } from '../llm/gate.svelte';
  import Button from '../ui/Button.svelte';
  const p = $derived(gate.pending);
  async function copy() { if (p) try { await navigator.clipboard.writeText(p.text); } catch { /* ignore */ } }
</script>

{#if p}
  <div class="pv">
    <header>
      <div class="t">发送前预览</div>
      <div class="s">{p.purpose} · {p.model} · 约 {p.tokens.toLocaleString()} token · 还没发出去</div>
    </header>
    <pre>{p.text}</pre>
    <footer>
      <Button onclick={() => p.resolve(true)}>发送</Button>
      <div class="row">
        <Button kind="tinted" onclick={() => p.resolve(false)}>取消</Button>
        <Button kind="tinted" onclick={copy}>复制</Button>
      </div>
    </footer>
  </div>
{/if}

<style>
  .pv { position: absolute; inset: 0; z-index: 70; background: var(--bg-grouped); color: var(--label); display: flex; flex-direction: column; padding-top: var(--safe-top); }
  header { padding: 12px 16px 8px; border-bottom: 0.5px solid var(--separator); }
  .t { font-size: 17px; font-weight: 600; }
  .s { font-size: 12px; color: var(--label-2); margin-top: 2px; }
  pre { flex: 1; margin: 0; padding: 12px 16px; overflow: auto; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Menlo, Consolas, monospace; background: var(--bg-surface); }
  footer { padding: 10px 16px calc(var(--safe-bottom) + 12px); display: flex; flex-direction: column; gap: 8px; border-top: 0.5px solid var(--separator); }
  .row { display: flex; gap: 8px; }
</style>

<script lang="ts">
  /** 「+」面板 → 撤回：发一行「你撤回了一条消息」。他只知道撤回了，看不到内容，照常回复 */
  import { List, Field, Button } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  let { onsend, onclose }: ComposerActionProps = $props();
  let count = $state('1');
  function send() {
    const n = Math.min(10, Math.max(1, Math.floor(Number(count) || 1)));
    const how = n > 1 ? ` ${n} 条` : '一条';
    onsend({ text: `（{{user}}撤回了${how}消息，你看不到内容）`, narration: `你撤回了${how}消息` });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }} role="presentation">
  <List footer="聊天里出一行「你撤回了一条消息」。他只知道你撤回了，看不到内容，想问就会问。">
    <Field label="撤回几条" bind:value={count} type="number" />
  </List>
</div>
<div class="actions">
  <Button onclick={send}>撤回</Button>
  <Button kind="plain" onclick={onclose}>取消</Button>
</div>

<style>
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

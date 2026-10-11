<script lang="ts">
  /** 「+」面板 → 拍一拍：发一行「你拍了拍他」，带他给自己定的后缀（像微信「拍了拍我的小脑袋」） */
  import { List, Field, Button } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  import { db } from '$kernel/storage/db';
  let { campaignId, characterId, onsend, onclose }: ComposerActionProps = $props();
  let count = $state('1');
  let name = $state('他');
  let suffix = $state('');
  $effect(() => {
    db().characters.get(characterId).then((c) => { if (c) name = c.name; });
    db().campaigns.get(campaignId).then((cp) => { suffix = cp?.state.nudge?.[characterId] ?? ''; });
  });
  function send() {
    const n = Math.min(10, Math.max(1, Math.floor(Number(count) || 1)));
    const times = n > 1 ? `，拍了 ${n} 次` : '';
    onsend({ text: `（{{user}}拍了拍你${suffix}${times}）`, narration: `你拍了拍${name}${suffix}${times}` });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }} role="presentation">
  <List footer={`聊天里出一行「你拍了拍${name}${suffix}」。后缀是他自己定的，主页「拍一拍」能改。`}>
    <Field label="拍几次" bind:value={count} type="number" />
  </List>
</div>
<div class="actions">
  <Button onclick={send}>拍一拍</Button>
  <Button kind="plain" onclick={onclose}>取消</Button>
</div>

<style>
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

<script lang="ts">
  /** 「+」面板 → 红包：金额和留言，从钱包扣 */
  import { List, Field, Button } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  import { redpacketApi, yuan } from './index';
  let { conversationId, campaignId, onsend, onclose }: ComposerActionProps = $props();
  let amount = $state('');
  let note = $state('恭喜发财，大吉大利');
  let wallet = $state<number | null>(null);
  let error = $state('');
  $effect(() => { redpacketApi.wallet().then((w) => (wallet = w)); });
  async function send() {
    const n = Math.round(Number(amount) * 100) / 100;
    if (!(n >= 0.01)) { error = '金额至少 0.01'; return; }
    if (wallet !== null && n > wallet) { error = '钱包不够了'; return; }
    const text = note.trim() || '恭喜发财，大吉大利';
    const p = await redpacketApi.create({ conversationId, campaignId, from: 'user', amount: n, note: text });
    await redpacketApi.adjust(-n);
    onsend({ text: `[发了一个红包：${yuan(n)}，留言「${text}」]`, cards: [{ tag: 'redpacket', body: JSON.stringify({ id: p.id }), alt: `[红包] ${text}` }], cardOnly: true });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }} role="presentation">
  <List footer={wallet === null ? '' : `钱包余额 ${yuan(wallet)}。这是本机的一个数字，纯玩。`}>
    <Field label="金额" bind:value={amount} placeholder="0.00" type="number" oninput={() => (error = '')} />
    <Field label="留言" bind:value={note} />
  </List>
</div>
{#if error}<p class="err">{error}</p>{/if}
<div class="actions">
  <Button onclick={send}>塞钱进红包</Button>
  <Button kind="plain" onclick={onclose}>取消</Button>
</div>

<style>
  .err { margin: 8px 32px 0; font-size: 13px; color: var(--red); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

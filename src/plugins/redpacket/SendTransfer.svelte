<script lang="ts">
  /** 「+」面板 → 转账：金额明摆着，备注可不填，从钱包扣。他回复完自动收下，除非他退回来 */
  import { List, Field, Button } from '$kernel/api';
  import type { ComposerActionProps } from '$kernel/api';
  import { redpacketApi, yuan } from './index';
  let { conversationId, campaignId, characterId, sourceId, onsend, onclose }: ComposerActionProps = $props();
  let amount = $state('');
  let note = $state('');
  let wallet = $state<number | null>(null);
  let error = $state('');
  $effect(() => { redpacketApi.wallet(campaignId, 'user').then((w) => (wallet = w)); });
  async function send() {
    const n = Math.round(Number(amount) * 100) / 100;
    if (!(n >= 0.01)) { error = '金额至少 0.01'; return; }
    if (wallet !== null && n > wallet) { error = '钱包不够了'; return; }
    const text = note.trim();
    const t = await redpacketApi.create({ conversationId, campaignId, characterId, kind: 'transfer', from: 'user', amount: n, note: text, sourceId });
    await redpacketApi.adjust(campaignId, 'user', -n, { reason: '转账', sourceId, packetId: t.id });
    onsend({ text: `[转给他 ${yuan(n)}${text ? '，备注「' + text + '」' : ''}]`, cards: [{ tag: 'transfer', body: JSON.stringify({ id: t.id }), alt: `[转账] ${yuan(n)}${text ? ' ' + text : ''}` }], cardOnly: true });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }} role="presentation">
  <List footer={wallet === null ? '' : `你在这一局的钱包余额 ${yuan(wallet)}。他回复完会自动收下，也可能退回来。`}>
    <Field label="金额" bind:value={amount} placeholder="0.00" type="number" oninput={() => (error = '')} />
    <Field label="备注" bind:value={note} placeholder="可不填" />
  </List>
</div>
{#if error}<p class="err">{error}</p>{/if}
<div class="actions">
  <Button onclick={send}>转账</Button>
  <Button kind="plain" onclick={onclose}>取消</Button>
</div>

<style>
  .err { margin: 8px 32px 0; font-size: 13px; color: var(--red); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

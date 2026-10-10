<script lang="ts">
  /** 角色主页上的钱包段：他和你在这一局的余额、最近几个红包。点余额可以手改（他是穷学生还是富二代由你定）。 */
  import { List, Cell, Sheet, Field, Button } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { redpacketApi, yuan, type Packet, type Wallet } from './index';
  let { campaignId, characterId }: ProfileSectionProps = $props();
  const deps = () => [campaignId, characterId];
  // 余额行不存在时 wallet() 会建；这里只读，没有就显示默认值，等第一次发红包再建
  const rows = live(() => redpacketApi.wallets().where('campaignId').equals(campaignId).toArray(), [] as Wallet[], deps);
  const recent = live(() => redpacketApi.recent(campaignId, 3), [] as Packet[], deps);
  const his = $derived(rows.value.find((w) => w.ownerId === characterId)?.balance);
  const mine = $derived(rows.value.find((w) => w.ownerId === 'user')?.balance);
  let editing = $state<string | null>(null);
  let draft = $state('');
  async function edit(owner: string) {
    draft = String(await redpacketApi.wallet(campaignId, owner));
    editing = owner;
  }
  async function save() {
    const n = Number(draft);
    if (editing && Number.isFinite(n)) await redpacketApi.setBalance(campaignId, editing, n);
    editing = null;
  }
  const fmt = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
</script>

<List footer="钱是这一局里的数字，换一局重新算。点余额可以手改。">
  <Cell title="他的余额" value={his === undefined ? '还没用过' : yuan(his)} onclick={() => edit(characterId)} />
  <Cell title="你的余额" value={mine === undefined ? '还没用过' : yuan(mine)} onclick={() => edit('user')} />
  {#each recent.value as p (p.id)}
    <Cell title={`${p.from === 'char' ? '他发的' : '你发的'} ${yuan(p.amount)}`} subtitle={`${fmt(p.createdAt)} · ${p.note}${p.openedAt ? '' : ' · 还没领'}`} />
  {/each}
</List>

<Sheet open={!!editing} onclose={() => (editing = null)} title={editing === 'user' ? '你的余额' : '他的余额'}>
  <List footer="直接写一个数。">
    <Field label="余额" bind:value={draft} type="number" />
  </List>
  <div class="actions"><Button onclick={save}>保存</Button></div>
</Sheet>

<style>
  .actions { display: flex; flex-direction: column; margin: 12px 16px 0; align-items: center; }
</style>

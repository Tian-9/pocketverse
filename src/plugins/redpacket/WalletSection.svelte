<script lang="ts">
  /** 角色主页上的钱包段：他和你在这一局的余额、最近几个红包。点余额可以手改（他是穷学生还是富二代由你定）。 */
  import { List, Cell, Sheet, Field, Button } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { live } from '$kernel/api';
  import { redpacketApi, yuan, isTransfer, type Packet } from './index';
  let { campaignId, characterId }: ProfileSectionProps = $props();
  const deps = () => [campaignId, characterId];
  // 只读（liveQuery 里不能写库）：还没用过的人不在里面，等第一次用到再记期初
  const bal = live(() => redpacketApi.balances(campaignId), {} as Record<string, number>, deps);
  const recent = live(() => redpacketApi.recent(campaignId, 3), [] as Packet[], deps);
  const his = $derived(bal.value[characterId]);
  const mine = $derived(bal.value['user']);
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

<List footer="钱是这一局里的数字，换一局重新算。点余额可以手改。红包和转账都从这里扣。">
  <Cell title="他的余额" value={his === undefined ? '还没用过' : yuan(his)} onclick={() => edit(characterId)} />
  <Cell title="你的余额" value={mine === undefined ? '还没用过' : yuan(mine)} onclick={() => edit('user')} />
  {#each recent.value as p (p.id)}
    <Cell title={`${p.from === 'char' ? '他' : '你'}${isTransfer(p) ? '转的' : '发的红包'} ${yuan(p.amount)}`} subtitle={[fmt(p.createdAt), p.note, p.refundedAt ? '已退回' : p.openedAt ? '' : isTransfer(p) ? '还没收' : '还没领'].filter(Boolean).join(' · ')} />
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

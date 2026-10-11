<script lang="ts">
  import { NavBar, List, Cell, SectionTitle, Glyph, icons } from '$kernel/api';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { priceNote } from '$kernel/llm/pricing';
  import { ROLES, EFFORTS } from '$kernel/llm/roles';
  import type { ModelRole } from '$kernel/llm/roles';

  let { role = 'chat' }: { role?: ModelRole } = $props();
  const info = $derived(ROLES.find((r) => r.id === role) ?? ROLES[0]!);
  const current = $derived(llm.modelFor(role));
  /** 当前选的模型不在列表里（比如列表刷新后它下线了）也要显示出来，不然看着像没选 */
  const options = $derived(llm.models.some((m) => m.id === current) ? llm.models : [{ id: current, label: current }, ...llm.models]);
  let refreshing = $state(false);
  let error = $state('');
  async function refresh() {
    refreshing = true; error = '';
    try { await llm.refreshModels(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { refreshing = false; }
  }
  const fetched = $derived(llm.modelsFetchedAt ? `列表来自 API，${new Date(llm.modelsFetchedAt).toLocaleDateString()} 拉的。` : '还没从 API 拉过列表，显示的是内置表。');
  const effortFooter: Record<ModelRole, string> = {
    chat: '越高回复越慢也越贵。聊天用中就够，复杂剧情再调高。',
    consolidate: '整理记忆是后台任务，低就够；记忆老漏东西再调高。',
    bulk: '货架、路人这类一次生成很多条，低最快；嫌内容敷衍再调高。',
  };
</script>

<NavBar title={info.label} back="API 与模型" />
<SectionTitle text="模型" />
<List footer={`${info.note}。${fetched}`}>
  {#each options as m (m.id)}
    <Cell title={m.label} subtitle={priceNote(m.id)} onclick={() => llm.setRole(role, { model: m.id })}>
      {#snippet right()}{#if current === m.id}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}{/snippet}
    </Cell>
  {/each}
  <Cell title={refreshing ? '正在拉取…' : '从 API 刷新列表'} subtitle={error || undefined} onclick={refreshing ? undefined : refresh} disabled={!llm.configured} />
</List>
<SectionTitle text="思考深度" />
<List footer={effortFooter[role]}>
  <div class="seg">
    {#each EFFORTS as e (e.id)}
      <button class:on={llm.effortFor(role) === e.id} onclick={() => llm.setRole(role, { effort: e.id })}>{e.label}</button>
    {/each}
  </div>
</List>
<div style="height:40px"></div>

<style>
  .seg { display: flex; gap: 4px; padding: 8px; background: var(--bg-surface); }
  .seg button { flex: 1; padding: 8px; border-radius: 8px; font-size: 15px; color: var(--label); background: var(--fill-2); }
  .seg button.on { background: var(--tint); color: var(--tint-fg); font-weight: 600; }
</style>

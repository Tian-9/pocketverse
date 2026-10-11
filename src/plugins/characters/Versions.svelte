<script lang="ts">
  /** 角色卡的历史版本：改卡前自动留的。点一份看内容，可以恢复（恢复前会把现在的样子也留一份）。 */
  import { NavBar, List, Cell, SectionTitle, Placeholder, Button, Sheet, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { versionsTable, backup, snapshotOf, sameData, type CharacterVersion } from './versions';

  let { id }: { id: string } = $props();
  const versions = live(() => versionsTable().where('characterId').equals(id).reverse().sortBy('createdAt'), [] as CharacterVersion[]);
  const character = live(() => db().characters.get(id), undefined);
  let picked = $state<CharacterVersion | null>(null);
  const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isCurrent = (v: CharacterVersion) => !!character.value && sameData(snapshotOf(character.value), v.data);
  const preview = (v: CharacterVersion) => (v.data.core.split('\n').find(Boolean) ?? '').slice(0, 60);

  async function restore() {
    const v = picked, c = character.value;
    if (!v || !c) return;
    await backup(c, '恢复前');
    await repo.updateCharacter(id, { ...v.data, firstMessage: v.data.firstMessage, useFirstMessage: !!v.data.useFirstMessage, timeZone: v.data.timeZone });
    picked = null;
    bus.emit('notify', { title: `已恢复到 ${fmt(v.createdAt)} 的版本` });
    await nav.pop();
  }
  async function remove() { if (picked) await versionsTable().delete(picked.id); picked = null; }
</script>

<NavBar title="历史版本" back="角色卡" />
{#if versions.value.length === 0}
  <Placeholder title="还没有历史版本" body="改角色卡之前会自动留一份，最多留 30 份。" paths={icons.sparkle} />
{:else}
  <SectionTitle text={`共 ${versions.value.length} 份`} />
  <List footer="每次改卡前自动留一份，和上一份一样就不重复留。点一份可以看内容、恢复或删除。">
    {#each versions.value as v (v.id)}
      <Cell title={`${fmt(v.createdAt)} · ${v.label}${isCurrent(v) ? ' · 和现在一样' : ''}`} subtitle={`${v.data.name}：${preview(v) || '（核心设定为空）'}`} chevron onclick={() => (picked = v)} />
    {/each}
  </List>
{/if}
<div style="height:40px"></div>

<Sheet open={!!picked} onclose={() => (picked = null)} title={picked ? fmt(picked.createdAt) : ''}>
  {#if picked}
    <List>
      <Cell title="名字" value={picked.data.name} />
      <Cell title="他所在的时区" value={picked.data.timeZone || '和你一样'} />
    </List>
    <SectionTitle text="核心设定" />
    <div class="box">{picked.data.core || '（空）'}</div>
    {#if picked.data.full}
      <SectionTitle text="完整设定" />
      <div class="box">{picked.data.full}</div>
    {/if}
    {#if picked.data.firstMessage}
      <SectionTitle text="开场白" />
      <div class="box">{picked.data.firstMessage}</div>
    {/if}
    <div class="actions">
      {#if !isCurrent(picked)}<Button onclick={restore}>恢复到这个版本</Button>{/if}
      <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除这份</span></Button>
    </div>
  {/if}
</Sheet>

<style>
  .box { margin: 0 16px; background: var(--bg-surface); border-radius: 12px; padding: 10px 12px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; max-height: 40vh; overflow: auto; color: var(--label); }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 16px 16px 0; align-items: center; }
</style>

<script lang="ts">
  import { NavBar, List, Cell, Placeholder, Avatar, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { parseCardFile, extractCardFromPng } from '$kernel/importers/charaCard';
  import { bus } from '$kernel/bus/bus';

  const chars = live(() => db().characters.orderBy('name').toArray(), []);
  let fileInput: HTMLInputElement;
  let busy = $state(false);

  async function onFiles(e: Event) {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    busy = true;
    try {
      // 一次只检查一张；多选的话逐张进检查页
      for (const f of files) {
        const card = await parseCardFile(f);
        const isPng = f.type === 'image/png' || f.name.toLowerCase().endsWith('.png');
        const raw = isPng ? extractCardFromPng(new Uint8Array(await f.arrayBuffer())) : JSON.parse(await f.text());
        nav.push('characters', 'inspect', { card, avatar: isPng ? f : undefined, raw });
      }
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
    }
  }
  async function createBlank() {
    const c = await repo.createCharacter({ name: '新角色', core: '', full: '' });
    nav.push('characters', 'detail', { id: c.id });
  }
</script>

<NavBar title="角色" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => fileInput.click()} aria-label="导入角色卡" disabled={busy}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>
<input type="file" accept=".png,.json,image/png,application/json" multiple bind:this={fileInput} onchange={onFiles} hidden />

{#if chars.value.length === 0}
  <Placeholder title="还没有角色" body="点右上角 + 导入 PNG 或 JSON 角色卡。导入前会先进检查页，可疑内容删干净再入库。" paths={icons.person} />
  <div class="actions">
    <button class="link" onclick={() => fileInput.click()}>导入角色卡</button>
    <button class="link" onclick={createBlank}>新建空白角色</button>
  </div>
{:else}
  <List>
    {#each chars.value as c (c.id)}
      <Cell title={c.name} subtitle={c.core.slice(0, 60).replace(/\n/g, ' ') || '还没有设定'} chevron onclick={() => nav.push('characters', 'profile', { id: c.id })}>
        {#snippet right()}{/snippet}
      </Cell>
    {/each}
  </List>
  <div class="actions"><button class="link" onclick={createBlank}>新建空白角色</button></div>
{/if}
<div style="height:40px"></div>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .actions { display: flex; justify-content: center; gap: 24px; margin: 16px; }
  .link { color: var(--tint); font-size: 17px; }
</style>

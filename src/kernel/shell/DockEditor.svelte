<script lang="ts">
  import { registry } from '../registry/registry.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import List from '../ui/List.svelte';
  import Cell from '../ui/Cell.svelte';
  import Icon from '../ui/Icon.svelte';
  import Glyph from '../ui/Glyph.svelte';
  import { icons } from '../ui/icons';
  let { open = $bindable(false) }: { open?: boolean } = $props();
  let selected = $state(0);
  const slots = $derived(registry.resolveDock());
  const current = $derived(registry.dock[selected]);

  function pick(pluginId: string, shortcutId: string) {
    registry.setDock(selected, { pluginId, shortcutId });
  }
  function clear() { registry.setDock(selected, null); }
</script>

<Sheet bind:open title="编辑 Dock">
  <p class="hint">先选一个格子，再选要放进去的快捷方式。插件开启后，它提供的快捷方式会自动出现在这里。</p>
  <div class="slots">
    {#each slots as s, i (i)}
      <button class="slot" class:sel={i === selected} onclick={() => (selected = i)} aria-label="格子 {i + 1}">
        {#if s}<Icon spec={s.icon ?? { paths: [], background: 'var(--fill)' }} size={48} shadow={false} />{:else}<Glyph paths={icons.plus} size={22} color="var(--label-3)" />{/if}
      </button>
    {/each}
  </div>
  <List>
    {#each registry.shortcuts as s (s.pluginId + '/' + s.id)}
      <Cell title={s.label} subtitle={(s.id === 'app' ? '主界面' : s.pluginName) + (s.available ? '' : ' · 插件未开启')} icon={s.icon} disabled={!s.available}
        onclick={s.available ? () => pick(s.pluginId, s.id) : undefined}>
        {#snippet right()}
          {#if current?.pluginId === s.pluginId && current?.shortcutId === s.id}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}
        {/snippet}
      </Cell>
    {/each}
    <Cell title="清空这一格" onclick={clear} />
  </List>
  <div style="height:16px"></div>
</Sheet>

<style>
  .hint { font-size: 13px; color: var(--label-2); margin: 0 32px 12px; line-height: 1.4; }
  .slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 0 16px 16px; }
  .slot { aspect-ratio: 1; border-radius: 16px; background: var(--bg-surface); display: grid; place-items: center; border: 2px solid transparent; }
  .slot.sel { border-color: var(--tint); }
</style>

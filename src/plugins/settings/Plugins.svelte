<script lang="ts">
  import { NavBar, List, Cell, Toggle, SectionTitle } from '$kernel/api';
  import { registry } from '$kernel/registry/registry.svelte';
  const core = $derived(registry.plugins.filter((p) => p.core));
  const optional = $derived(registry.plugins.filter((p) => !p.core));
  function describe(p: (typeof registry.plugins)[number]) {
    const bits: string[] = [];
    if (p.app) bits.push('桌面图标');
    if (p.shortcuts?.length) bits.push(`${p.shortcuts.length} 个快捷方式`);
    if (p.promptContributors?.length) bits.push('注入提示词');
    if (p.tools?.length) bits.push(`${p.tools.length} 个工具`);
    if (p.outputHandlers?.length) bits.push('解析 <' + p.outputHandlers.map((h) => h.tag).join('> <') + '>');
    if (p.storage) bits.push('自有数据表');
    return bits.join(' · ') || '无贡献点';
  }
</script>

<NavBar title="插件" back="设置" />
<SectionTitle text="内核" />
<List>
  {#each core as p (p.id)}
    <Cell title={p.name} subtitle={describe(p)} icon={p.app?.icon} value="内核" />
  {/each}
</List>
<SectionTitle text="插件" />
<List footer="关闭插件后数据保留，重新开启即恢复。">
  {#each optional as p (p.id)}
    <Cell title={p.name} subtitle={describe(p)} icon={p.app?.icon}>
      {#snippet right()}
        <Toggle checked={registry.isEnabled(p.id)} label={p.name} onchange={(v) => registry.setEnabled(p.id, v)} />
      {/snippet}
    </Cell>
  {/each}
</List>
<div style="height:40px"></div>

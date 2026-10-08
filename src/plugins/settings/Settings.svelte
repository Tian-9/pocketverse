<script lang="ts">
  import { NavBar, List, Cell, SectionTitle, icons } from '$kernel/api';
  import { gradients } from '$kernel/ui/icons';
  import { nav } from '$kernel/nav/nav.svelte';
  import { registry } from '$kernel/registry/registry.svelte';
  import { theme } from '$kernel/theme/theme.svelte';
  const modeLabel = $derived({ system: '跟随系统', light: '浅色', dark: '深色' }[theme.mode]);
  const enabledCount = $derived(registry.plugins.filter((p) => !p.core && registry.isEnabled(p.id)).length);
</script>

<NavBar title="设置" large back="桌面" />
<SectionTitle text="模型" />
<List footer="M1 接入 Claude 后在这里填 API Key，并能看到本月用量和缓存命中率。">
  <Cell title="API 与模型" subtitle="尚未配置" icon={{ paths: icons.sparkle, background: gradients.purple }} chevron />
</List>
<SectionTitle text="外观" />
<List>
  <Cell title="外观" value={modeLabel} icon={{ paths: icons.image, background: gradients.blue }} chevron onclick={() => nav.push('settings', 'appearance')} />
</List>
<SectionTitle text="扩展" />
<List footer="开关插件会即时增减桌面图标和 Dock 候选项。">
  <Cell title="插件" value={`${enabledCount} 个已开启`} icon={{ paths: icons.plug, background: gradients.black }} chevron onclick={() => nav.push('settings', 'plugins')} />
</List>
<SectionTitle text="关于" />
<List>
  <Cell title="Pocketverse" value="0.0.1 · M0" />
</List>
<div style="height:40px"></div>

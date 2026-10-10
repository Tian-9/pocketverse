<script lang="ts">
  import { NavBar, List, Cell, SectionTitle, icons } from '$kernel/api';
  import { gradients } from '$kernel/ui/icons';
  import { nav } from '$kernel/nav/nav.svelte';
  import { registry } from '$kernel/registry/registry.svelte';
  import { theme } from '$kernel/theme/theme.svelte';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { MODELS } from '$kernel/llm/pricing';
  import { chat } from '$kernel/chat/engine.svelte';
  const modelLabel = $derived(MODELS.find((m) => m.id === llm.settings.model)?.label ?? llm.settings.model);
  const modeLabel = $derived({ system: '跟随系统', light: '浅色', dark: '深色' }[theme.mode]);
  const enabledCount = $derived(registry.plugins.filter((p) => !p.core && registry.isEnabled(p.id)).length);
</script>

<NavBar title="设置" large back="桌面" />
<SectionTitle text="模型" />
<List footer={llm.configured ? `本月 $${llm.stats.monthUsd.toFixed(2)} · 缓存命中 ${llm.stats.requests ? Math.round(llm.stats.hitRate * 100) + '%' : '—'}` : '还没有配置 API Key，聊天前先填。'}>
  <Cell title="API 与模型" value={llm.configured ? modelLabel : '未配置'} icon={{ paths: icons.sparkle, background: gradients.purple }} chevron onclick={() => nav.push('settings', 'api')} />
</List>
<List footer="基础对话规则，相当于预设的主提示词。">
  <Cell title="对话规则" value={chat.rules ? '已自定义' : '默认'} icon={{ paths: icons.book, background: gradients.teal }} chevron onclick={() => nav.push('settings', 'rules')} />
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
<List footer="日志只存在本机，记的是决策和结果（为什么合并、请求花了多少、哪里出错），不记聊天正文。出问题时复制发给开发者。">
  <Cell title="Pocketverse" value="0.0.5 · M3" subtitle={`构建 ${__BUILD__}`} />
  <Cell title="日志" icon={{ paths: icons.diary, background: gradients.gray }} chevron onclick={() => nav.push('settings', 'logs')} />
  <Cell title="原始流" subtitle="和模型之间的每一个 SSE 事件，学习与排错用" icon={{ paths: icons.globe, background: gradients.indigo }} chevron onclick={() => nav.push('settings', 'rawstream')} />
</List>
<div style="height:40px"></div>

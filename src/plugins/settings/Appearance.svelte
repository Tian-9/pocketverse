<script lang="ts">
  import { NavBar, List, Cell, SectionTitle, icons } from '$kernel/api';
  import Glyph from '$kernel/ui/Glyph.svelte';
  import { theme, type ThemeMode, type ChatStyle } from '$kernel/theme/theme.svelte';
  const chatStyles: { id: ChatStyle; label: string; sub: string }[] = [
    { id: 'ios', label: '信息', sub: '蓝白气泡，iOS 信息的样子' },
    { id: 'wechat', label: '微信', sub: '绿白气泡，灰底，两边都有头像' },
  ];
  const modes: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: '跟随系统' },
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
  ];
</script>

<NavBar title="外观" back="设置" />
<SectionTitle text="聊天样式" />
<List footer="只换聊天页的样子，功能一样。">
  {#each chatStyles as c (c.id)}
    <Cell title={c.label} subtitle={c.sub} onclick={() => theme.setChatStyle(c.id)}>
      {#snippet right()}
        {#if theme.chatStyle === c.id}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}
      {/snippet}
    </Cell>
  {/each}
</List>
<SectionTitle text="模式" />
<List footer="主题包（配色、壁纸、图标风格）在 M4 作为插件接入。">
  {#each modes as m (m.id)}
    <Cell title={m.label} onclick={() => theme.setMode(m.id)}>
      {#snippet right()}
        {#if theme.mode === m.id}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}
      {/snippet}
    </Cell>
  {/each}
</List>

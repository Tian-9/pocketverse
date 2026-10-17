<script lang="ts">
  /** 对话规则：线上（手机聊天）和线下（面对面推剧情）各一份，按会话模式选（ARCHITECTURE 6.1） */
  import { NavBar, List, SectionTitle, Button } from '$kernel/api';
  import { chat } from '$kernel/chat/engine.svelte';
  import { DEFAULT_RULES, OFFLINE_RULES } from '$kernel/context/assemble';
  let mode = $state<'online' | 'offline'>('online');
  const fallback = $derived(mode === 'offline' ? OFFLINE_RULES : DEFAULT_RULES);
  let text = $state(chat.rules || DEFAULT_RULES);
  $effect(() => { text = (mode === 'offline' ? chat.rulesOffline : chat.rules) || fallback; });
  let t: ReturnType<typeof setTimeout> | undefined;
  function save() {
    clearTimeout(t);
    const m = mode, v = text.trim() === fallback.trim() ? '' : text;
    t = setTimeout(() => (m === 'offline' ? chat.setRulesOffline(v) : chat.setRules(v)), 400);
  }
  function reset() { text = fallback; if (mode === 'offline') chat.setRulesOffline(''); else chat.setRules(''); }
</script>

<NavBar title="对话规则" back="设置" />
<div class="seg">
  <button class:on={mode === 'online'} onclick={() => (mode = 'online')}>线上 · 手机聊天</button>
  <button class:on={mode === 'offline'} onclick={() => (mode = 'offline')}>线下 · 面对面</button>
</div>
<SectionTitle text="每轮都在最前面的基础规则" />
<List footer={mode === 'offline' ? '线下会话（角色主页「线下见面」）用这一份：小说写法，他写动作神态和话。相当于 SillyTavern 预设里的主提示词。' : '相当于 SillyTavern 预设里的主提示词。改这里影响所有角色。想让某种风格只在部分场景生效，用「风格」里带触发词的条目。'}>
  <div class="box"><textarea bind:value={text} rows="12" oninput={save} spellcheck="false"></textarea></div>
</List>
<div class="actions"><Button kind="plain" onclick={reset}>恢复默认</Button></div>
<div style="height:40px"></div>

<style>
  .seg { display: flex; gap: 4px; margin: 12px 16px 0; padding: 3px; background: var(--fill-2); border-radius: 10px; }
  .seg button { flex: 1; padding: 7px 0; border-radius: 8px; font-size: 14px; color: var(--label-2); }
  .seg button.on { background: var(--bg-surface); color: var(--label); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .box { padding: 8px 12px; background: var(--bg-surface); }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 15px; line-height: 1.5; resize: vertical; }
  .actions { display: flex; justify-content: center; margin: 16px; }
</style>

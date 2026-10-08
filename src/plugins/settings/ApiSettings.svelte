<script lang="ts">
  import { NavBar, List, Cell, Field, SectionTitle, Toggle, Glyph, icons } from '$kernel/api';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { MODELS } from '$kernel/llm/pricing';
  import { chat } from '$kernel/chat/engine.svelte';

  let key = $state(llm.settings.apiKey);
  let userName = $state(chat.userName);
  let userProfile = $state(chat.userProfile);
  let testing = $state(false);
  let testResult = $state('');
  const efforts: { id: typeof llm.settings.effort; label: string }[] = [
    { id: 'low', label: '低' }, { id: 'medium', label: '中' }, { id: 'high', label: '高' }, { id: 'xhigh', label: '很高' },
  ];
  async function test() {
    testing = true; testResult = '';
    try { await llm.save({ apiKey: key }); testResult = '连接正常：' + (await llm.ping()); }
    catch (e) { testResult = e instanceof Error ? e.message : String(e); }
    finally { testing = false; }
  }
  const usd = (n: number) => '$' + n.toFixed(n < 1 ? 3 : 2);
</script>

<NavBar title="API 与模型" back="设置" />
<SectionTitle text="Anthropic" />
<List footer="Key 只存在这台设备的浏览器里，直接从浏览器调用 Anthropic。">
  <Field label="API Key" type="password" bind:value={key} placeholder="sk-ant-…" oninput={(v) => llm.save({ apiKey: v })} />
  <Cell title={testing ? '测试中…' : '测试连接'} onclick={testing ? undefined : test} />
</List>
{#if testResult}<p class="result" class:bad={!testResult.startsWith('连接正常')}>{testResult}</p>{/if}

<SectionTitle text="模型" />
<List>
  {#each MODELS as m (m.id)}
    <Cell title={m.label} subtitle={m.note} onclick={() => llm.save({ model: m.id })}>
      {#snippet right()}{#if llm.settings.model === m.id}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}{/snippet}
    </Cell>
  {/each}
</List>
<SectionTitle text="思考深度" />
<List footer="越高回复越慢也越贵。聊天用中就够，复杂剧情再调高。">
  <div class="seg">
    {#each efforts as e (e.id)}
      <button class:on={llm.settings.effort === e.id} onclick={() => llm.save({ effort: e.id })}>{e.label}</button>
    {/each}
  </div>
</List>

<SectionTitle text="记忆与工具" />
<List footer="开着时角色可以翻世界书、回忆、记状态、维护自己的笔记。关掉只靠常驻设定和触发词，更快更省。">
  <Cell title="允许角色用工具">{#snippet right()}<Toggle checked={llm.settings.tools !== false} label="工具" onchange={(v) => llm.save({ tools: v })} />{/snippet}</Cell>
</List>

<SectionTitle text="你" />
<List footer="角色会用这个名字称呼你。自我介绍会常驻在上下文里，写你希望所有角色都知道的事。">
  <Field label="名字" bind:value={userName} placeholder="我" oninput={(v) => chat.setUserName(v)} />
  <Field multiline rows={3} bind:value={userProfile} placeholder="自我介绍，可选" oninput={(v) => chat.setUserProfile(v)} />
</List>

<SectionTitle text="用量" />
<List footer={llm.stats.requests > 0 && llm.stats.hitRate < 0.7 ? '缓存命中率偏低。前几轮对话命中率低是正常的，持续偏低说明有东西在破坏缓存前缀。' : '缓存命中率是最重要的省钱指标，稳定聊天时应在 70% 以上。'}>
  <Cell title="今天" value={usd(llm.stats.todayUsd)} />
  <Cell title="本月" value={usd(llm.stats.monthUsd)} subtitle={`${llm.stats.requests} 次请求`} />
  <Cell title="缓存命中率" value={llm.stats.requests ? Math.round(llm.stats.hitRate * 100) + '%' : '—'} subtitle="最近 50 次请求" />
</List>
<div style="height:40px"></div>

<style>
  .result { margin: 8px 32px 0; font-size: 13px; color: var(--green); }
  .result.bad { color: var(--red); }
  .seg { display: flex; gap: 4px; padding: 8px; background: var(--bg-surface); }
  .seg button { flex: 1; padding: 8px; border-radius: 8px; font-size: 15px; color: var(--label); background: var(--fill-2); }
  .seg button.on { background: var(--tint); color: var(--tint-fg); font-weight: 600; }
</style>

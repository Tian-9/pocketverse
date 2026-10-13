<script lang="ts">
  import { NavBar, List, Cell, Field, SectionTitle, Toggle, PlacePicker, icons, live, places } from '$kernel/api';
  import type { Place } from '$kernel/api';
  import { nav } from '$kernel/nav/nav.svelte';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { ROLES, effortLabel } from '$kernel/llm/roles';
  import { chat } from '$kernel/chat/engine.svelte';

  let key = $state(llm.settings.apiKey);
  let userName = $state(chat.userName);
  let userProfile = $state(chat.userProfile);
  const userPlace = live(() => places.user(), places.DEFAULT_USER_PLACE);
  let pickingPlace = $state(false);
  const pickPlace = (p: Place | null) => { if (p) places.setUser(p); };
  let testing = $state(false);
  let testResult = $state('');
  const modelLabel = (id: string) => llm.models.find((m) => m.id === id)?.label ?? id;
  const caps = [2048, 4096, 8192, 16384, 32768];
  const k = (n: number) => `${n / 1024}k`;
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
<List footer="按用途分三档，每档选模型和思考深度。对话吃缓存，贵模型命中缓存可能比便宜模型没命中还便宜；整理和批量都是一次性输入，便宜的看效果选。">
  {#each ROLES as r (r.id)}
    <Cell title={r.label} value={modelLabel(llm.modelFor(r.id))} subtitle={`思考深度 ${effortLabel(llm.effortFor(r.id))}`} chevron onclick={() => nav.push('settings', 'models', { role: r.id })} />
  {/each}
</List>
<SectionTitle text="正文上限" />
<List footer="一次回复最多写多少 token，思考另外加。这是上限不是花费，钱按实际写了多少算；设小了只会把长回复、长日记截断。货架这类自己要得更多的不受它限制。">
  <div class="seg">
    {#each caps as c (c)}
      <button class:on={llm.settings.maxTokens === c} onclick={() => llm.save({ maxTokens: c })}>{k(c)}</button>
    {/each}
  </div>
</List>

<SectionTitle text="安全" />
<List footer="开着时，每一次发给模型的请求（聊天、记忆整理、朋友圈、日记）都会先整页显示出来，你点发送才真的发。想看清楚到底传了什么就开它。">
  <Cell title="发送前预览完整请求">{#snippet right()}<Toggle checked={!!llm.settings.preview} label="预览" onchange={(v) => llm.save({ preview: v })} />{/snippet}</Cell>
</List>
<SectionTitle text="思考" />
<List footer="开着时，聊天回复下面可以展开模型的思考摘要。这是 Anthropic 官方提供的摘要展示，不是原始思维链，计费不变。只对聊天生效。">
  <Cell title="显示思考摘要">{#snippet right()}<Toggle checked={!!llm.settings.showThinking} label="思考摘要" onchange={(v) => llm.save({ showThinking: v })} />{/snippet}</Cell>
</List>
<SectionTitle text="记忆与工具" />
<List footer="开着时角色可以翻世界书、回忆、记状态、维护自己的笔记、分享歌曲。关掉只靠常驻设定和触发词，更快更省。">
  <Cell title="允许角色用工具">{#snippet right()}<Toggle checked={llm.settings.tools !== false} label="工具" onchange={(v) => llm.save({ tools: v })} />{/snippet}</Cell>
</List>
<SectionTitle text="联网" />
<List footer="开着时角色可以用 Anthropic 的联网搜索和读网页，由 Anthropic 服务端执行。搜索按次计费：每次 $0.01，另加搜到内容占的 token，已计入下面的用量。每轮最多搜 3 次。关着时角色只靠本地资料，分享歌曲查不到就不引歌词。需要先开「允许角色用工具」。">
  <Cell title="允许角色上网" subtitle={llm.stats.webSearches ? `本月搜了 ${llm.stats.webSearches} 次，约 $${(llm.stats.webSearches * 0.01).toFixed(2)}` : '每次搜索 $0.01'}>{#snippet right()}<Toggle checked={!!llm.settings.web} label="上网" onchange={(v) => llm.save({ web: v })} />{/snippet}</Cell>
</List>

<SectionTitle text="你" />
<List footer="角色会用这个名字称呼你。某一局想用别的名字，在角色主页「你在这局叫」里单独改。自我介绍会常驻在上下文里，写你希望所有角色都知道的事。">
  <Field label="名字" bind:value={userName} placeholder="我" oninput={(v) => chat.setUserName(v)} />
  <Field multiline rows={3} bind:value={userProfile} placeholder="自我介绍，可选" oninput={(v) => chat.setUserProfile(v)} />
</List>
<List footer="天气、他那边几点都从这里算。默认伦敦，改成你所在的城市；只存在这台设备上，城市名会和天气一起出现在提示词里。">
  <Cell title="你在哪座城市" value={userPlace.value.name} chevron onclick={() => (pickingPlace = true)} />
</List>
<PlacePicker bind:open={pickingPlace} title="你在哪座城市" allowLocate onpick={pickPlace} onclose={() => (pickingPlace = false)} />

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

<script lang="ts">
  /** 可疑内容列表 → 每条点开编辑：命中那句话高亮展示，文本框里选中命中词，可删词、删句、手改、标记没问题。 */
  import { NavBar, List, Cell, SectionTitle, Placeholder, Sheet, Button, icons } from '$kernel/api';
  import { draft, sentenceRange } from './draft.svelte';
  import { tick } from 'svelte';

  type F = (typeof draft.findings)[number];
  let editing = $state<F | null>(null);
  let text = $state('');
  let ta = $state<HTMLTextAreaElement | null>(null);
  const groups = $derived(Object.entries(draft.open.reduce<Record<string, F[]>>((a, f) => ((a[f.kind] ??= []).push(f), a), {})));
  const ignoredList = $derived(draft.findings.filter((f) => draft.ignored[f.key]));
  const isIgnored = $derived(!!editing && !!draft.ignored[editing.key]);

  /** 命中处的上下文：前后各 30 字，命中词单独拿出来给模板高亮 */
  const ctx = $derived.by(() => {
    if (!editing) return { before: '', hit: '', after: '' };
    const s = editing.index, e = s + editing.length;
    return { before: text.slice(Math.max(0, s - 30), s), hit: text.slice(s, e), after: text.slice(e, e + 30) };
  });

  async function open(f: F) {
    editing = f; text = draft.getText(f.field);
    await tick();
    selectHit();
  }
  /** Android Chrome 在键盘弹出时会重置选区，所以设几次 */
  function selectHit() {
    const f = editing; if (!f || !ta) return;
    const apply = () => { if (!ta || editing !== f) return; ta.focus({ preventScroll: true }); ta.setSelectionRange(f.index, f.index + f.length); scrollToSelection(); };
    apply(); setTimeout(apply, 80); setTimeout(apply, 350);
  }
  function scrollToSelection() {
    if (!ta) return;
    // 把命中行滚到文本框中间：用前文的行数估算高度
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    const linesBefore = text.slice(0, editing?.index ?? 0).split('\n').length - 1;
    ta.scrollTop = Math.max(0, linesBefore * lineH - ta.clientHeight / 2);
  }
  function range(kind: 'word' | 'sentence'): [number, number] {
    if (!editing) return [0, 0];
    return kind === 'word' ? [editing.index, editing.index + editing.length] : sentenceRange(text, editing.index, editing.length);
  }
  function preview(kind: 'word' | 'sentence'): string { const [s, e] = range(kind); return text.slice(s, e); }
  function remove(kind: 'word' | 'sentence') {
    const [s, e] = range(kind);
    text = text.slice(0, s) + text.slice(e);
    save();
  }
  function save() { if (editing) draft.setText(editing.field, text); editing = null; }
  function ignore() { if (editing) draft.ignored[editing.key] = true; editing = null; }
  function unignore() { if (editing) delete draft.ignored[editing.key]; editing = null; }
</script>

<NavBar title="可疑内容" back="检查" />
{#if draft.open.length === 0 && ignoredList.length === 0}
  <Placeholder title="没有可疑内容" paths={icons.check} />
{/if}
{#each groups as [kind, list] (kind)}
  <SectionTitle text={`${kind} · ${list.length}`} />
  <List>
    {#each list as f (f.key)}<Cell title={f.label} subtitle={`…${f.snippet}…`} chevron onclick={() => open(f)} />{/each}
  </List>
{/each}
{#if ignoredList.length}
  <SectionTitle text={`已标记为没问题 · ${ignoredList.length}`} />
  <List footer="点开可以取消标记。">
    {#each ignoredList as f (f.key)}<Cell title={`${f.kind} · ${f.label}`} subtitle={`…${f.snippet}…`} chevron onclick={() => open(f)} />{/each}
  </List>
{/if}
<div style="height:40px"></div>

<Sheet open={!!editing} onclose={() => (editing = null)} title={editing ? `${editing.kind} · ${editing.label}` : ''}>
  {#if editing}
    <p class="ctx">…{ctx.before}<mark>{ctx.hit}</mark>{ctx.after}…</p>
    <div class="box"><textarea bind:this={ta} bind:value={text} rows="7" spellcheck="false"></textarea></div>
    <div class="actions">
      <button class="jump" onclick={selectHit}>在文本框里定位到「{ctx.hit}」</button>
      {#if !isIgnored}
        <Button kind="tinted" onclick={() => remove('word')}>只删「{preview('word')}」</Button>
        <Button kind="tinted" onclick={() => remove('sentence')}>删掉这一句：{preview('sentence').slice(0, 24)}{preview('sentence').length > 24 ? '…' : ''}</Button>
      {/if}
      <Button onclick={save}>保存修改</Button>
      {#if isIgnored}
        <Button kind="plain" onclick={unignore}>取消"没问题"标记</Button>
      {:else}
        <Button kind="plain" onclick={ignore}>这段没问题，标记掉</Button>
      {/if}
      <Button kind="plain" onclick={() => (editing = null)}>取消</Button>
    </div>
  {/if}
</Sheet>

<style>
  .ctx { margin: 0 20px 8px; font-size: 14px; line-height: 1.5; color: var(--label-2); white-space: pre-wrap; word-break: break-all; }
  mark { background: color-mix(in srgb, var(--yellow) 55%, transparent); color: var(--label); border-radius: 3px; padding: 0 2px; font-weight: 600; }
  .box { margin: 0 16px; background: var(--bg-surface); border-radius: 12px; padding: 8px 12px; }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 15px; line-height: 1.5; resize: vertical; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
  .jump { color: var(--tint); font-size: 14px; padding: 4px; }
</style>

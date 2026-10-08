<script lang="ts">
  /** 可疑内容列表 → 每条点开编辑：光标定位到命中处，可删词、删句、手改、标记没问题。 */
  import { NavBar, List, Cell, SectionTitle, Placeholder, Sheet, Button, icons } from '$kernel/api';
  import { draft, sentenceRange } from './inspect.svelte';
  import { tick } from 'svelte';

  type F = (typeof draft.findings)[number];
  let editing = $state<F | null>(null);
  let text = $state('');
  let ta = $state<HTMLTextAreaElement | null>(null);
  const groups = $derived(Object.entries(draft.open.reduce<Record<string, F[]>>((a, f) => ((a[f.kind] ??= []).push(f), a), {})));
  const ignoredList = $derived(draft.findings.filter((f) => draft.ignored[f.key]));

  async function open(f: F) {
    editing = f; text = draft.getText(f.field);
    await tick();
    const start = Math.min(f.index, text.length);
    ta?.focus();
    ta?.setSelectionRange(start, Math.min(text.length, start + guessLen(f)));
  }
  function guessLen(f: F) { return Math.max(1, f.length); }
  function preview(kind: 'word' | 'sentence'): string {
    if (!editing) return '';
    const len = guessLen(editing);
    const [s, e] = kind === 'word' ? [editing.index, editing.index + len] : sentenceRange(text, editing.index, len);
    return text.slice(s, e);
  }
  function remove(kind: 'word' | 'sentence') {
    if (!editing) return;
    const len = guessLen(editing);
    const [s, e] = kind === 'word' ? [editing.index, editing.index + len] : sentenceRange(text, editing.index, len);
    text = text.slice(0, s) + text.slice(e);
    save();
  }
  function save() { if (editing) draft.setText(editing.field, text); editing = null; }
  function ignore(f: F) { draft.ignored[f.key] = true; editing = null; }
  function unignore(f: F) { delete draft.ignored[f.key]; }
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
  <List footer="点一下取消标记。">
    {#each ignoredList as f (f.key)}<Cell title={`${f.kind} · ${f.label}`} subtitle={`…${f.snippet}…`} onclick={() => unignore(f)} />{/each}
  </List>
{/if}
<div style="height:40px"></div>

<Sheet open={!!editing} title={editing ? `${editing.kind} · ${editing.label}` : ''}>
  {#if editing}
    <p class="hint">命中：<mark>{preview('word')}</mark>。已在下面选中，可以直接改。</p>
    <div class="box"><textarea bind:this={ta} bind:value={text} rows="8" spellcheck="false"></textarea></div>
    <div class="actions">
      <Button kind="tinted" onclick={() => remove('word')}>只删「{preview('word')}」</Button>
      <Button kind="tinted" onclick={() => remove('sentence')}>删掉这一句：{preview('sentence').slice(0, 24)}{preview('sentence').length > 24 ? '…' : ''}</Button>
      <Button onclick={save}>保存修改</Button>
      <Button kind="plain" onclick={() => ignore(editing!)}>这段没问题，标记掉</Button>
      <Button kind="plain" onclick={() => (editing = null)}>取消</Button>
    </div>
  {/if}
</Sheet>

<style>
  .hint { margin: 0 20px 8px; font-size: 14px; color: var(--label-2); }
  mark { background: color-mix(in srgb, var(--yellow) 45%, transparent); color: var(--label); border-radius: 3px; padding: 0 2px; }
  .box { margin: 0 16px; background: var(--bg-surface); border-radius: 12px; padding: 8px 12px; }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 15px; line-height: 1.5; resize: vertical; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>

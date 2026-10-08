<script lang="ts">
  /** 列表里的输入行：左标签，右输入 */
  let { label, value = $bindable(''), placeholder = '', type = 'text', multiline = false, rows = 4, oninput }: { label?: string; value?: string; placeholder?: string; type?: string; multiline?: boolean; rows?: number; oninput?: (v: string) => void } = $props();
  const id = 'f-' + Math.random().toString(36).slice(2, 8);
</script>

<div class="field" class:multiline>
  {#if label}<label for={id}>{label}</label>{/if}
  {#if multiline}
    <textarea {id} bind:value {placeholder} {rows} oninput={() => oninput?.(value)}></textarea>
  {:else}
    <input {id} {type} bind:value {placeholder} oninput={() => oninput?.(value)} autocomplete="off" autocapitalize="off" spellcheck="false" />
  {/if}
</div>

<style>
  .field { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 8px 16px; position: relative; }
  .field + :global(.field)::before, .field + :global(.cell)::before, :global(.cell) + .field::before { content: ''; position: absolute; top: 0; left: 16px; right: 0; border-top: 0.5px solid var(--separator); }
  .field.multiline { flex-direction: column; align-items: stretch; gap: 6px; }
  label { font-size: 17px; color: var(--label); flex: 0 0 auto; }
  .multiline label { font-size: 13px; color: var(--label-2); }
  input, textarea { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; font-size: 17px; color: var(--label); text-align: right; padding: 0; }
  .multiline input, textarea { text-align: left; resize: vertical; line-height: 1.45; font-size: 16px; }
  input::placeholder, textarea::placeholder { color: var(--label-3); }
</style>

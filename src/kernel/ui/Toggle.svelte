<script lang="ts">
  let { checked = $bindable(false), onchange, label, disabled = false }: { checked?: boolean; onchange?: (v: boolean) => void; label?: string; disabled?: boolean } = $props();
  function flip() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button class="toggle" role="switch" aria-checked={checked} aria-label={label} {disabled} onclick={flip}></button>

<style>
  .toggle { width: 51px; height: 31px; border-radius: 16px; background: var(--fill); position: relative; transition: background 0.2s; flex: 0 0 auto; }
  .toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16); transition: transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
  .toggle[aria-checked="true"] { background: var(--green); }
  .toggle[aria-checked="true"]::after { transform: translateX(20px); }
  .toggle:disabled { opacity: 0.4; }
</style>

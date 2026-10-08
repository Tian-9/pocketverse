<script lang="ts">
  let { blob, name, size = 40 }: { blob?: Blob; name: string; size?: number } = $props();
  let url = $state<string | null>(null);
  $effect(() => {
    if (!blob) { url = null; return; }
    const u = URL.createObjectURL(blob);
    url = u;
    return () => URL.revokeObjectURL(u);
  });
  const hue = $derived([...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360);
</script>

{#if url}
  <img class="avatar" src={url} alt={name} style="width:{size}px;height:{size}px" />
{:else}
  <span class="avatar initials" style="width:{size}px;height:{size}px;font-size:{size * 0.42}px;background:hsl({hue} 55% 55%)">{name.slice(0, 1)}</span>
{/if}

<style>
  .avatar { border-radius: 50%; flex: 0 0 auto; object-fit: cover; display: inline-grid; place-items: center; color: #fff; font-weight: 600; }
</style>

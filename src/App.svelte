<script lang="ts">
  import Shell from '$kernel/shell/Shell.svelte';
  import PhoneFrame from '$kernel/shell/PhoneFrame.svelte';
  let wide = $state(window.innerWidth >= 560);
  $effect(() => {
    const mql = window.matchMedia('(min-width: 560px)');
    const fn = () => (wide = mql.matches);
    mql.addEventListener('change', fn);
    return () => mql.removeEventListener('change', fn);
  });
</script>

{#if wide}
  <PhoneFrame><Shell /></PhoneFrame>
{:else}
  <Shell />
{/if}

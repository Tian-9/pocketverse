<script lang="ts">
  import Home from './Home.svelte';
  import ScreenHost from './ScreenHost.svelte';
  import Banner from './Banner.svelte';
  import PromptPreview from './PromptPreview.svelte';
  import { registry } from '../registry/registry.svelte';
</script>

<div class="shell">
  {#if registry.ready}
    <Home />
    <ScreenHost />
    <Banner />
    <PromptPreview />
  {/if}
</div>

<style>
  .shell { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: var(--font); color: var(--label); background: var(--bg-grouped); -webkit-font-smoothing: antialiased; }
</style>

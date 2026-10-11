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
  /* contain: paint 让 .shell 成为 fixed 后代的包含块：弹窗（Sheet）在滚动中的界面里也钉在底部，桌面上不会跑出手机框 */
  .shell { position: relative; width: 100%; height: 100%; overflow: hidden; contain: paint; font-family: var(--font); color: var(--label); background: var(--bg-grouped); -webkit-font-smoothing: antialiased; }
</style>

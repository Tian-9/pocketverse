<script lang="ts">
  /** 一张模型画的图：svg 必须是 sanitizeSvg 清洗过的字符串；没有就显示图标。只当图片显示，不内联 */
  import Glyph from './Glyph.svelte';
  import { svgDataUrl } from './svg';
  let { svg, size = 48, radius = '8px', fallback, alt = '' }: { svg?: string | null; size?: number | string; radius?: string; fallback?: string[]; alt?: string } = $props();
  const px = $derived(typeof size === 'number' ? size + 'px' : size);
  const glyph = $derived(typeof size === 'number' ? Math.round(size * 0.45) : 24);
</script>

<span class="picture" style="width:{px};height:{px};border-radius:{radius}">
  {#if svg}
    <img src={svgDataUrl(svg)} {alt} loading="lazy" draggable="false" />
  {:else if fallback}
    <Glyph paths={fallback} size={glyph} color="var(--label-3)" width={1.8} />
  {/if}
</span>

<style>
  .picture { display: inline-flex; align-items: center; justify-content: center; background: var(--fill-2); overflow: hidden; flex: 0 0 auto; }
  img { width: 100%; height: 100%; object-fit: contain; padding: 8%; box-sizing: border-box; }
</style>

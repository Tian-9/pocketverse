<script lang="ts">
  /** 行内小图标（不带背景），用于导航栏、单元格附件 */
  let { paths, size = 20, color = 'currentColor', width = 2 }: { paths: string[]; size?: number; color?: string; width?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} stroke-width={width} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each paths as d}<path {d} />{/each}
</svg>

<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<h2 class="section">{text}</h2>

<style>
  .section { font-size: 13px; font-weight: 400; color: var(--label-2); text-transform: uppercase; letter-spacing: 0.02em; margin: 22px 32px 7px; }
</style>

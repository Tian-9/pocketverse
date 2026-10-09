export * from './types';
import type { PluginManifest } from './types';

/** 插件入口。目前只做结构校验，返回原对象，便于以后加包装。 */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    throw new Error(`插件 id 只能用小写字母、数字和连字符: ${manifest.id}`);
  }
  for (const t of manifest.tools ?? []) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(t.name)) throw new Error(`插件 ${manifest.id} 的工具名不合法（只能字母数字下划线连字符）: ${t.name}`);
  }
  for (const r of manifest.shares ?? []) {
    if (!/^[a-z][a-z0-9_-]*$/.test(r.type)) throw new Error(`插件 ${manifest.id} 的分享类型不合法: ${r.type}`);
  }
  if (manifest.storage) {
    for (const t of Object.keys(manifest.storage.tables)) {
      if (!/^[a-z][a-z0-9_]*$/.test(t)) throw new Error(`插件 ${manifest.id} 的表名不合法: ${t}`);
    }
  }
  return manifest;
}

/** 内核组件库和图标，插件只能从这里拿 UI。 */
export { default as NavBar } from '../ui/NavBar.svelte';
export { default as List } from '../ui/List.svelte';
export { default as Cell } from '../ui/Cell.svelte';
export { default as Toggle } from '../ui/Toggle.svelte';
export { default as Sheet } from '../ui/Sheet.svelte';
export { default as Button } from '../ui/Button.svelte';
export { default as Icon } from '../ui/Icon.svelte';
export { default as SectionTitle } from '../ui/SectionTitle.svelte';
export { default as Placeholder } from '../ui/Placeholder.svelte';
export { default as Field } from '../ui/Field.svelte';
export { default as Avatar } from '../ui/Avatar.svelte';
export { default as Glyph } from '../ui/Glyph.svelte';
export { default as ShareCardView } from '../ui/ShareCard.svelte';
export { icons, gradients } from '../ui/icons';

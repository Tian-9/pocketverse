import { definePlugin, icons, gradients } from '$kernel/api';
import Style from './Style.svelte';
import PresetInspect from './PresetInspect.svelte';
import PresetEntryEdit from './PresetEntryEdit.svelte';

export default definePlugin({
  id: 'style',
  name: '风格',
  version: '0.2.0',
  core: true,
  description: '风格与附加指令：怎么说话、什么文风。能导入酒馆预设当风格包，整包开关。',
  app: { screen: Style, icon: { paths: icons.sparkle, background: gradients.purple } },
  screens: { 'preset-inspect': PresetInspect, 'preset-entry': PresetEntryEdit },
});

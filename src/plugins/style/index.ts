import { definePlugin, icons, gradients } from '$kernel/api';
import Style from './Style.svelte';

export default definePlugin({
  id: 'style',
  name: '风格',
  version: '0.1.0',
  core: true,
  description: '风格与附加指令：怎么说话、什么文风。常驻的排在规则后面，带触发词的命中时插入。',
  app: { screen: Style, icon: { paths: icons.sparkle, background: gradients.purple } },
});

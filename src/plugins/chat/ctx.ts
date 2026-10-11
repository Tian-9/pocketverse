import type { PluginContext } from '$kernel/api';

/** 聊天插件的 PluginContext：界面要用别的插件的服务（如日历）从这里拿。单独一个文件，免得 index.ts 和界面互相 import */
export let chatCtx: PluginContext | undefined;
export function setChatCtx(c: PluginContext) { chatCtx = c; }

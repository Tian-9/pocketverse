import type { PluginManifest } from '$kernel/api';
import chat from './chat';
import characters from './characters';
import lore from './lore';
import settings from './settings';
import moments from './moments';
import diary from './diary';

/** 内置插件清单。顺序决定桌面图标顺序。 */
export const builtinPlugins: PluginManifest[] = [chat, characters, lore, settings, moments, diary];

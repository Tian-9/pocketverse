import type { PluginManifest } from '$kernel/api';
import chat from './chat';
import characters from './characters';
import lore from './lore';
import style from './style';
import settings from './settings';
import moments from './moments';
import diary from './diary';
import music from './music';
import redpacket from './redpacket';

/** 内置插件清单。顺序决定桌面图标顺序。 */
export const builtinPlugins: PluginManifest[] = [chat, characters, lore, style, settings, moments, diary, music, redpacket];

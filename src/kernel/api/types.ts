import type { Component } from 'svelte';
import type { Table } from 'dexie';
import type { ShareResolver } from '../share/types';

export type { ShareCard, ShareQuery, ShareResult, ShareResolver } from '../share/types';

/** 插件清单：插件通过 definePlugin() 声明，内核据此收集贡献点。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 内核级插件不可关闭 */
  core?: boolean;
  /** 桌面图标与主界面 */
  app?: AppContribution;
  /** 暴露给 Dock 的快捷方式 */
  shortcuts?: Shortcut[];
  /** 其他可打开的界面，按 id 导航 */
  screens?: Record<string, Component<any>>;
  /** 往提示词里注入的内容（M1 起生效） */
  promptContributors?: PromptContributor[];
  /** L2 工具（M2 起生效） */
  tools?: ToolDef[];
  /** 解析模型输出里的标签（M1 起生效） */
  outputHandlers?: OutputHandler[];
  /** 分享解析器：内核的 share 工具按 type 分发到这里 */
  shares?: ShareResolver[];
  /** 补发登记：离开一段时间回来，内核按档位把各插件的事拼成一次调用 */
  catchup?: CatchupContributor[];
  /** 自有数据表：表名 -> Dexie schema 字符串，内核会加 p_<id>_ 前缀 */
  storage?: { tables: Record<string, string> };
  /** 事件订阅 */
  onEvent?: Partial<EventHandlers>;
  /** 启用时调用 */
  setup?(ctx: PluginContext): void | Promise<void>;
  /** 停用时调用 */
  teardown?(): void | Promise<void>;
}

export interface AppContribution {
  screen: Component<any>;
  /** 图标样式：内置渐变名或自定义 CSS 背景 */
  icon: IconSpec;
  badge?: () => number;
}

export interface IconSpec {
  /** 图标内容：SVG path 的 d 字符串数组（24x24 坐标系） */
  paths: string[];
  /** 背景：预设名或任意 CSS background 值 */
  background: string;
  /** 描边还是填充 */
  mode?: 'stroke' | 'fill';
}

export interface Shortcut {
  id: string;
  label: string;
  icon?: IconSpec;
  /** 目标界面：插件 screens 里的 key，或 'app' 表示主界面 */
  screen: string;
  params?: Record<string, unknown>;
}

export interface PromptContributor {
  id: string;
  /** 稳定部分，进 system，参与缓存 */
  stable?: (ctx: PromptContext) => string | Promise<string>;
  /** 易变部分，进最后一条用户消息 */
  volatile?: (ctx: PromptContext) => string | Promise<string>;
}

export interface PromptContext {
  campaignId: string;
  conversationId: string;
  characterIds: string[];
}

export interface ToolDef {
  name: string;
  /** 聊天状态栏里显示的动作，如「发朋友圈」 */
  label?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, ctx: PromptContext) => Promise<unknown>;
}

export interface OutputHandler {
  /** 匹配的标签名，如 'moment' 对应 <moment>…</moment> */
  tag: string;
  /** 渲染卡片的组件，接收 { body, attrs } */
  component: Component<any>;
  /** 解析到标签时的副作用，如落库 */
  onParsed?: (body: string, attrs: Record<string, string>, ctx: PromptContext) => void | Promise<void>;
}

/** 补发档位：h6 ≥ 6 小时，d1 ≥ 24 小时，days ≥ 2 天；attach 不触发，有补发就带上 */
export type CatchupTier = 'h6' | 'd1' | 'days' | 'attach';

export interface CatchupContext {
  campaignId: string;
  characterId: string;
  characterName: string;
  /** 距上次和这个角色互动（或上次补发）的时长 */
  elapsedMs: number;
  /** 整天数，days 档才有意义 */
  days: number;
  /** 这次达到的档位 */
  tier: Exclude<CatchupTier, 'attach'>;
  /** 给模型看的时长，如「大约 8 小时」「3 天」 */
  elapsedText: string;
}

export interface CatchupItem {
  /** 这一段的标题，如「朋友圈」 */
  label: string;
  /** 材料和任务说明 */
  prompt: string;
  /** 这一段的 JSON schema，内核挂到总 schema 的一个属性下 */
  schema: Record<string, unknown>;
  /** 模型答完，这一段的结果 */
  apply(output: unknown, ctx: CatchupContext): Promise<void>;
}

export interface CatchupContributor {
  id: string;
  tier: CatchupTier;
  /** 收集这次要处理的事；null 表示没事 */
  collect(ctx: CatchupContext): Promise<CatchupItem | null>;
}

/** 内核事件表。插件自定义事件用 `<pluginId>.<name>` 命名。 */
export interface KernelEvents {
  'app.opened': { pluginId: string };
  'app.closed': { pluginId: string };
  'app.resumed': { elapsedMs: number };
  'plugin.enabled': { pluginId: string };
  'plugin.disabled': { pluginId: string };
  'theme.changed': { themeId: string };
  'notify': { title: string; body?: string; pluginId?: string; screen?: string; action?: () => void };
  'llm.turn.start': { conversationId: string };
  'llm.turn.end': { conversationId: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number }; model: string };
  'llm.turn.error': { conversationId: string; message: string };
  'memory.written': { kind: 'state' | 'overlay' | 'episodic' | 'memfs'; id: string };
  'memory.consolidated': { campaignId: string; memories: number; overlays: number };
  'catchup.done': { campaignId: string; tier: string; keys: string[] };
}
export type EventName = keyof KernelEvents | (string & {});
export type EventHandlers = {
  [K in keyof KernelEvents]: (payload: KernelEvents[K]) => void;
} & Record<string, (payload: any) => void>;

export interface PluginContext {
  id: string;
  /** 发事件 */
  emit<K extends keyof KernelEvents>(name: K, payload: KernelEvents[K]): void;
  emit(name: string, payload: unknown): void;
  /** 导航 */
  navigate(screen: string, params?: Record<string, unknown>): void;
  back(): void;
  /** 通知条 */
  notify(title: string, body?: string, screen?: string): void;
  /** 本插件的键值设置 */
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };
  /** 本插件在 manifest.storage 里声明的表 */
  table<T = unknown>(name: string): Table<T, any>;
  /** 调模型，自动记账到本插件名下 */
  llm: {
    chat(req: PluginChatRequest): Promise<{ text: string }>;
    configured: boolean;
  };
  /** 最近玩过的存档及其角色（最近 7 天） */
  activeCampaigns(): Promise<ActiveCampaign[]>;
}

export interface PluginChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  /** 用便宜模型 */
  cheap?: boolean;
}

export interface ActiveCampaign {
  campaignId: string;
  characterId: string;
  characterName: string;
  lastPlayedAt: number;
}

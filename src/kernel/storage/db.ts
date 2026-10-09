import Dexie, { type Table } from 'dexie';
import type { PluginManifest } from '../api/types';

/** 内核表。字段定义见 docs/ARCHITECTURE.md 第 4 节。 */
export interface World { id: string; name: string; summary: string; createdAt: number; updatedAt: number }
export interface LoreEntry {
  id: string; worldId: string; title: string; summary: string; content: string;
  scope: 'world' | 'character' | 'relation'; characterIds?: string[];
  /** 设定（可查、可覆盖）还是风格指令（像规则一样插入） */
  kind?: 'lore' | 'style';
  triggers: { keywords: string[]; regex?: string; recursive?: boolean };
  constant: boolean; order: number; enabled: boolean;
}
export interface Character {
  id: string; worldId: string; name: string; avatar?: Blob;
  core: string; full: string; firstMessage?: string;
  /** 新对话是否自动发开场白；酒馆卡的开场白多半不合小手机场景，默认不发 */
  useFirstMessage?: boolean;
  /** 时间模式：real 跟随真实时间（默认）；story 只用剧情时间，由角色和用户推进 */
  timeMode?: 'real' | 'story';
  voice?: Record<string, unknown>;
}
export interface CampaignState {
  inWorldTime?: string; location?: string;
  relations: Record<string, string>; mood: Record<string, string>; facts: string[];
}
export interface Campaign {
  id: string; worldId: string; characterIds: string[]; name: string;
  createdAt: number; lastPlayedAt: number; state: CampaignState;
  /** 上次合并处理到的消息 ts */
  consolidatedUpTo?: number;
  /** 上次补发的时间，和 lastPlayedAt 一起决定下次补发的档位 */
  catchupAt?: number;
}
export interface Conversation { id: string; campaignId: string; kind: string; participantIds: string[]; pluginId: string }
export interface Message {
  id: string; conversationId: string; role: 'user' | 'assistant' | 'system';
  content: unknown[]; ts: number; inWorldTs?: string; tokens?: number;
  /** 附加信息：用过的工具名、补发标记等 */
  meta?: Record<string, unknown>;
}
export interface EpisodicMemory {
  id: string; campaignId: string; characterId?: string; when: string; text: string;
  importance: 1 | 2 | 3; sourceMessageIds: string[]; createdAt: number;
}
export interface LoreOverlay {
  id: string; campaignId: string; loreEntryId?: string; title: string; summary: string;
  content: string; reason: string; createdAt: number;
  /** 合并任务提出、尚未被用户采纳 */
  pending?: boolean;
}
export interface MemFile { campaignId: string; path: string; content: string; updatedAt: number }
export interface KV { key: string; value: unknown }
export interface LogRecord { id: string; ts: number; level: 'info' | 'warn' | 'error'; tag: string; message: string; data?: Record<string, unknown> }
export interface UsageRecord {
  id: string; ts: number; model: string; conversationId?: string; purpose: string;
  input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number;
  webSearches?: number;
}

const KERNEL_SCHEMA: Record<string, string> = {
  worlds: 'id, name, updatedAt',
  lore: 'id, worldId, scope, order, enabled',
  characters: 'id, worldId, name',
  campaigns: 'id, worldId, lastPlayedAt',
  conversations: 'id, campaignId, pluginId',
  messages: 'id, conversationId, ts',
  memories: 'id, campaignId, characterId, importance, createdAt',
  overlays: 'id, campaignId, loreEntryId, createdAt',
  kv: 'key',
  usage: 'id, ts, conversationId',
  memfs: '[campaignId+path], campaignId',
  logs: 'id, ts, level, tag',
};

/** 内核表结构改动时递增 */
const KERNEL_VERSION = 4;

export class PocketDB extends Dexie {
  worlds!: Table<World, string>;
  lore!: Table<LoreEntry, string>;
  characters!: Table<Character, string>;
  campaigns!: Table<Campaign, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  memories!: Table<EpisodicMemory, string>;
  overlays!: Table<LoreOverlay, string>;
  kv!: Table<KV, string>;
  usage!: Table<UsageRecord, string>;
  memfs!: Table<MemFile, [string, string]>;
  logs!: Table<LogRecord, string>;

  constructor(name = 'pocketverse', plugins: PluginManifest[] = []) {
    super(name);
    const schema = { ...KERNEL_SCHEMA };
    for (const p of plugins) {
      for (const [t, s] of Object.entries(p.storage?.tables ?? {})) schema[pluginTable(p.id, t)] = s;
    }
    // 版本号 = 内核版本 * 100 + 插件表数量：内核改表或加插件表都会触发升级，Dexie 会补建新表。
    const pluginTables = Object.keys(schema).length - Object.keys(KERNEL_SCHEMA).length;
    this.version(KERNEL_VERSION * 100 + pluginTables).stores(schema);
  }

  async getKV<T>(key: string, fallback: T): Promise<T> {
    const row = await this.kv.get(key);
    return row ? (row.value as T) : fallback;
  }
  async setKV<T>(key: string, value: T): Promise<void> {
    await this.kv.put({ key, value });
  }
}

export function pluginTable(pluginId: string, table: string): string {
  return `p_${pluginId.replace(/-/g, '_')}_${table}`;
}

let instance: PocketDB | undefined;
export function openDB(plugins: PluginManifest[]): PocketDB {
  if (!instance) instance = new PocketDB('pocketverse', plugins);
  return instance;
}
export function db(): PocketDB {
  if (!instance) throw new Error('数据库尚未打开，先调用 openDB()');
  return instance;
}

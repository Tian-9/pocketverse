import Dexie, { type Table } from 'dexie';
import type { PluginManifest } from '../api/types';

/** 内核表。字段定义见 docs/ARCHITECTURE.md 第 4 节。 */
export interface World { id: string; name: string; summary: string; createdAt: number; updatedAt: number }
export interface LoreEntry {
  id: string; worldId: string; title: string; summary: string; content: string;
  scope: 'world' | 'character' | 'relation'; characterIds?: string[];
  triggers: { keywords: string[]; regex?: string; recursive?: boolean };
  constant: boolean; order: number; enabled: boolean;
}
export interface Character {
  id: string; worldId: string; name: string; avatar?: Blob;
  core: string; full: string; firstMessage?: string; voice?: Record<string, unknown>;
}
export interface CampaignState {
  inWorldTime?: string; location?: string;
  relations: Record<string, string>; mood: Record<string, string>; facts: string[];
}
export interface Campaign {
  id: string; worldId: string; characterIds: string[]; name: string;
  createdAt: number; lastPlayedAt: number; state: CampaignState;
}
export interface Conversation { id: string; campaignId: string; kind: string; participantIds: string[]; pluginId: string }
export interface Message {
  id: string; conversationId: string; role: 'user' | 'assistant' | 'system';
  content: unknown[]; ts: number; inWorldTs?: string; tokens?: number;
}
export interface EpisodicMemory {
  id: string; campaignId: string; characterId?: string; when: string; text: string;
  importance: 1 | 2 | 3; sourceMessageIds: string[]; createdAt: number;
}
export interface LoreOverlay {
  id: string; campaignId: string; loreEntryId?: string; title: string; summary: string;
  content: string; reason: string; createdAt: number;
}
export interface KV { key: string; value: unknown }

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
};

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

  constructor(name = 'pocketverse', plugins: PluginManifest[] = []) {
    super(name);
    const schema = { ...KERNEL_SCHEMA };
    for (const p of plugins) {
      for (const [t, s] of Object.entries(p.storage?.tables ?? {})) schema[pluginTable(p.id, t)] = s;
    }
    // 版本号 = 内核版本 + 插件表数量：加插件表会触发升级，Dexie 会补建新表。
    this.version(1 + Object.keys(schema).length - Object.keys(KERNEL_SCHEMA).length).stores(schema);
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

import Dexie, { type Table } from 'dexie';
import type { PluginManifest, Place } from '../api/types';

/** 内核表。字段定义见 docs/ARCHITECTURE.md 第 4 节。 */
export interface World { id: string; name: string; summary: string; createdAt: number; updatedAt: number }
export interface LoreEntry {
  id: string;
  /** 所属世界。风格指令是 'global'；人物背景（scope character）跟卡走、不属于任何世界，写 'character' */
  worldId: string; title: string; summary: string; content: string;
  scope: 'world' | 'character' | 'relation'; characterIds?: string[];
  /** 设定（可查、可覆盖）还是风格指令（像规则一样插入） */
  kind?: 'lore' | 'style';
  /** 风格指令的位置：system（规则后面，默认）或 tail（对话历史之后、你这句之前，模型最听这里的） */
  position?: 'system' | 'tail';
  /** 所属预设（风格包）名，整包可以一起开关、导出 */
  preset?: string;
  triggers: { keywords: string[]; regex?: string; recursive?: boolean };
  constant: boolean; order: number; enabled: boolean;
}
/** 角色卡：演员本身，不绑世界。在哪个世界玩由存档决定（一张卡可以在不同世界各开一局） */
export interface Character {
  id: string; name: string; avatar?: Blob;
  core: string; full: string; firstMessage?: string;
  /** 新对话是否自动发开场白；酒馆卡的开场白多半不合小手机场景，默认不发 */
  useFirstMessage?: boolean;
  /** 他所在的时区（IANA 名，如 Asia/Tokyo）。留空＝和你同一个时区；出远门才填，提示词里会多给一个"他那边的时间" */
  timeZone?: string;
  /** 他在哪座城市。留空＝和你在同一个地方（天气、时区都跟你）；选了城市 timeZone 跟着填。见 data/place.ts */
  place?: Place;
  voice?: Record<string, unknown>;
}
export interface CampaignState {
  location?: string;
  relations: Record<string, string>; mood: Record<string, string>; facts: string[];
}
/** 存档时钟：这一局「现在几点」。见 context/clock.ts；没有＝和真实时间一样 */
export interface CampaignClock {
  /** 锚点：真实时刻 anchorRealTs 时，剧情时刻是 anchorStoryTs */
  anchorStoryTs: number; anchorRealTs: number;
  /** 走表（剧情时间随真实时间流逝）还是停表（只有推进才动） */
  running: boolean;
}
export interface Campaign {
  id: string; worldId: string; characterIds: string[]; name: string;
  createdAt: number; lastPlayedAt: number; state: CampaignState;
  clock?: CampaignClock;
  /** 你在这个世界里是谁（一两句话）。按存档分：修仙世界里是师弟，校园里是同桌。没有就只用全局的用户画像 */
  userPersona?: string;
  /** 上次合并处理到的消息 ts */
  consolidatedUpTo?: number;
  /** 上次补发的时间，和 lastPlayedAt 一起决定下次补发的档位 */
  catchupAt?: number;
  /** 上次互动 / 上次补发时的剧情时刻：补发按剧情时长算（停表的局你不来他不动；跳过时间算他过了那段） */
  playedStoryTs?: number; catchupStoryTs?: number;
  /** 上次整理失败（出错或预览里取消）时处理到的消息 ts；之后再攒够一批回复才会再试 */
  consolidateFailedAt?: number;
}
export interface Conversation { id: string; campaignId: string; kind: string; participantIds: string[]; pluginId: string }
export interface Message {
  id: string; conversationId: string; role: 'user' | 'assistant' | 'system';
  content: unknown[]; ts: number; tokens?: number;
  /** 这条消息时的剧情时刻（存档时钟），没时钟的局等于 ts */
  storyTs?: number;
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
  worlds: 'id, name, createdAt, updatedAt',
  lore: 'id, worldId, scope, order, enabled',
  characters: 'id, name',
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
const KERNEL_VERSION = 6;

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
    this.version(KERNEL_VERSION * 100 + pluginTables).stores(schema).upgrade(async (tx) => {
      // v6：剧情时间从自由文本换成存档时钟。旧的「剧情时间」字符串解析不了，塞进事实里不丢
      await tx.table('campaigns').toCollection().modify((c: Campaign & { state: CampaignState & { inWorldTime?: string } }) => {
        const t = c.state?.inWorldTime;
        if (!t) return;
        delete c.state.inWorldTime;
        c.state.facts = [`之前记的剧情时间：${t}`, ...(c.state.facts ?? [])].slice(0, 20);
      });
    });
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

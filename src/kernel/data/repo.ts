import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { World, Character, Campaign, Conversation, Message } from '../storage/db';
import type { MessageCard } from '../api/types';
import { expandMacros } from '../context/macros';

/** 当前存档的指针：kv 里 `kernel.currentCampaign.<characterId>` */
const currentKey = (characterId: string) => `kernel.currentCampaign.${characterId}`;

/**
 * 领域操作。一个角色默认一个存档；同一张卡可以在不同世界各开一局，「当前这一局」用 kv 指针记着，
 * 聊天、主页、补发都只看当前这一局。
 */
export const repo = {
  async ensureDefaultWorld(): Promise<World> {
    const existing = await db().worlds.orderBy('createdAt').first();
    if (existing) return existing;
    const w: World = { id: ulid(), name: '默认世界', summary: '', createdAt: Date.now(), updatedAt: Date.now() };
    await db().worlds.add(w);
    return w;
  },

  async createWorld(name: string, summary = ''): Promise<World> {
    const w: World = { id: ulid(), name: name.trim() || '未命名世界', summary: summary.trim(), createdAt: Date.now(), updatedAt: Date.now() };
    await db().worlds.add(w);
    return w;
  },

  async updateWorld(id: string, patch: Partial<Pick<World, 'name' | 'summary'>>) {
    await db().worlds.update(id, { ...patch, updatedAt: Date.now() });
  },

  /** 删世界连它的条目一起删；有存档在用就拒绝（返回 false），免得把别人的记忆删没了 */
  async deleteWorld(id: string): Promise<boolean> {
    if (await db().campaigns.where('worldId').equals(id).count()) return false;
    await db().transaction('rw', [db().worlds, db().lore], async () => {
      await db().lore.where('worldId').equals(id).delete();
      await db().worlds.delete(id);
    });
    return true;
  },

  async createCharacter(input: Omit<Character, 'id'>): Promise<Character> {
    const c: Character = { ...input, id: ulid() };
    await db().characters.add(c);
    return c;
  },

  async updateCharacter(id: string, patch: Partial<Character>) {
    await db().characters.update(id, patch);
  },

  async deleteCharacter(id: string) {
    const campaigns = await db().campaigns.filter((c) => c.characterIds.includes(id)).toArray();
    await db().transaction('rw', [db().characters, db().campaigns, db().conversations, db().messages, db().memories, db().overlays, db().kv], async () => {
      for (const c of campaigns) await this.deleteCampaign(c.id);
      await db().characters.delete(id);
    });
  },

  async deleteCampaign(id: string) {
    const convs = await db().conversations.where('campaignId').equals(id).toArray();
    for (const cv of convs) await db().messages.where('conversationId').equals(cv.id).delete();
    await db().conversations.where('campaignId').equals(id).delete();
    await db().memories.where('campaignId').equals(id).delete();
    await db().overlays.where('campaignId').equals(id).delete();
    await db().campaigns.delete(id);
    for (const row of await db().kv.where('key').startsWith('kernel.currentCampaign.').toArray()) {
      if (row.value === id) await db().kv.delete(row.key);
    }
  },

  /** 这张卡的所有存档（单人局），按创建顺序 */
  async campaignsOf(characterId: string): Promise<Campaign[]> {
    const all = await db().campaigns.filter((c) => c.characterIds.length === 1 && c.characterIds[0] === characterId).toArray();
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  /** 角色当前这一局，没有就在默认世界建一局。 */
  async campaignFor(character: Character): Promise<Campaign> {
    const currentId = await db().getKV<string | null>(currentKey(character.id), null);
    if (currentId) { const c = await db().campaigns.get(currentId); if (c) return c; }
    const mine = await this.campaignsOf(character.id);
    if (mine.length) {
      const latest = mine.reduce((a, b) => (b.lastPlayedAt > a.lastPlayedAt ? b : a));
      await db().setKV(currentKey(character.id), latest.id);
      return latest;
    }
    return this.newCampaign(character, (await this.ensureDefaultWorld()).id);
  },

  /** 给这张卡在某个世界新开一局，并切成当前这一局 */
  async newCampaign(character: Character, worldId: string): Promise<Campaign> {
    const world = await db().worlds.get(worldId);
    const c: Campaign = {
      id: ulid(), worldId, characterIds: [character.id], name: world?.name ?? character.name,
      createdAt: Date.now(), lastPlayedAt: Date.now(),
      state: { relations: {}, mood: {}, facts: [] },
    };
    await db().campaigns.add(c);
    await db().setKV(currentKey(character.id), c.id);
    return c;
  },

  async setCurrentCampaign(characterId: string, campaignId: string) {
    await db().setKV(currentKey(characterId), campaignId);
  },

  /** 所有角色当前这一局的 id：列表、补发、朋友圈只看这些，别的局先睡着 */
  async currentCampaignIds(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const ch of await db().characters.toArray()) {
      const id = await db().getKV<string | null>(currentKey(ch.id), null);
      if (id) { out.add(id); continue; }
      const mine = await this.campaignsOf(ch.id);
      if (mine.length) out.add(mine.reduce((a, b) => (b.lastPlayedAt > a.lastPlayedAt ? b : a)).id);
    }
    return out;
  },

  /** 角色的私聊会话，没有就建，并写入开场白。 */
  async directConversation(character: Character, pluginId = 'chat'): Promise<Conversation> {
    const campaign = await this.campaignFor(character);
    const found = await db().conversations.where('campaignId').equals(campaign.id).filter((c) => c.kind === 'direct' && c.pluginId === pluginId).first();
    if (found) return found;
    const conv: Conversation = { id: ulid(), campaignId: campaign.id, kind: 'direct', participantIds: [character.id], pluginId };
    await db().conversations.add(conv);
    if (character.useFirstMessage && character.firstMessage?.trim()) {
      const userName = await db().getKV('kernel.userName', '我');
      await this.addMessage(conv.id, 'assistant', expandMacros(character.firstMessage.trim(), { user: userName, char: character.name }));
    }
    return conv;
  },

  async addMessage(conversationId: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Promise<Message> {
    const m: Message = { id: ulid(), conversationId, role, content: [{ type: 'text', text }], ts: Date.now(), ...extra };
    await db().messages.add(m);
    const conv = await db().conversations.get(conversationId);
    if (conv) await db().campaigns.update(conv.campaignId, { lastPlayedAt: Date.now() });
    return m;
  },

  async messagesOf(conversationId: string): Promise<Message[]> {
    return db().messages.where('conversationId').equals(conversationId).sortBy('ts');
  },

  async characterOfConversation(conv: Conversation): Promise<Character | undefined> {
    const id = conv.participantIds[0];
    return id ? db().characters.get(id) : undefined;
  },
};

export function textOf(m: Message): string {
  return (m.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

/** 消息上挂的卡片（meta.cards） */
export function cardsOf(m: Message): MessageCard[] {
  return (m.meta?.cards as MessageCard[] | undefined) ?? [];
}

/**
 * 给模型看的文字：正文 + 各卡片的 alt。只有卡片的回复这样才能进历史，否则角色下一轮就不记得自己发过。
 * 用户从「+」面板发的 cardOnly 消息，text 本身就是给模型的描述，不再追加 alt。
 */
export function modelTextOf(m: Message): string {
  const text = textOf(m).trim();
  if (m.meta?.cardOnly) return text;
  const alts = cardsOf(m).map((c) => c.alt?.trim()).filter((s): s is string => !!s);
  return [text, ...alts].filter(Boolean).join('\n');
}

/** 聊天列表里的一行预览：有卡片 alt 用 alt，否则用正文 */
export function previewOf(m: Message): string {
  const alts = cardsOf(m).map((c) => c.alt?.trim()).filter((s): s is string => !!s);
  const text = textOf(m).trim();
  if (m.meta?.cardOnly) return alts.join(' ') || text;
  return text || alts.join(' ');
}

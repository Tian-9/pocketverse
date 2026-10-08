import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { World, Character, Campaign, Conversation, Message } from '../storage/db';

/** 领域操作。存档概念对用户隐藏：一个角色默认一个存档。 */
export const repo = {
  async ensureDefaultWorld(): Promise<World> {
    const existing = await db().worlds.orderBy('updatedAt').first();
    if (existing) return existing;
    const w: World = { id: ulid(), name: '默认世界', summary: '', createdAt: Date.now(), updatedAt: Date.now() };
    await db().worlds.add(w);
    return w;
  },

  async createCharacter(input: Omit<Character, 'id' | 'worldId'> & { worldId?: string }): Promise<Character> {
    const worldId = input.worldId ?? (await this.ensureDefaultWorld()).id;
    const c: Character = { ...input, id: ulid(), worldId };
    await db().characters.add(c);
    return c;
  },

  async updateCharacter(id: string, patch: Partial<Character>) {
    await db().characters.update(id, patch);
  },

  async deleteCharacter(id: string) {
    const campaigns = await db().campaigns.filter((c) => c.characterIds.includes(id)).toArray();
    await db().transaction('rw', [db().characters, db().campaigns, db().conversations, db().messages, db().memories, db().overlays], async () => {
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
  },

  /** 角色的默认存档，没有就建。 */
  async campaignFor(character: Character): Promise<Campaign> {
    const found = await db().campaigns.where('worldId').equals(character.worldId).filter((c) => c.characterIds.length === 1 && c.characterIds[0] === character.id).first();
    if (found) return found;
    const c: Campaign = {
      id: ulid(), worldId: character.worldId, characterIds: [character.id], name: character.name,
      createdAt: Date.now(), lastPlayedAt: Date.now(),
      state: { relations: {}, mood: {}, facts: [] },
    };
    await db().campaigns.add(c);
    return c;
  },

  /** 角色的私聊会话，没有就建，并写入开场白。 */
  async directConversation(character: Character, pluginId = 'chat'): Promise<Conversation> {
    const campaign = await this.campaignFor(character);
    const found = await db().conversations.where('campaignId').equals(campaign.id).filter((c) => c.kind === 'direct' && c.pluginId === pluginId).first();
    if (found) return found;
    const conv: Conversation = { id: ulid(), campaignId: campaign.id, kind: 'direct', participantIds: [character.id], pluginId };
    await db().conversations.add(conv);
    if (character.useFirstMessage && character.firstMessage?.trim()) await this.addMessage(conv.id, 'assistant', character.firstMessage.trim());
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

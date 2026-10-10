import { db } from '../storage/db';
import type { Campaign } from '../storage/db';
import { repo } from './repo';
import { loreApplies } from './lore';
import { loreDirectory } from '../context/assemble';
import type { DataView, CampaignView } from '../api/types';

async function toView(c: Campaign): Promise<CampaignView | undefined> {
  const chId = c.characterIds[0];
  const [ch, world] = await Promise.all([chId ? db().characters.get(chId) : undefined, db().worlds.get(c.worldId)]);
  if (!ch) return undefined;
  return {
    id: c.id, name: c.name, worldId: c.worldId, worldName: world?.name ?? '', characterId: ch.id, characterName: ch.name,
    lastPlayedAt: c.lastPlayedAt, state: structuredClone(c.state),
  };
}

/** PluginContext.data 的实现：插件读内核数据的唯一入口，只读。 */
export const dataView: DataView = {
  async currentCampaigns() {
    const ids = await repo.currentCampaignIds();
    const cps = (await db().campaigns.bulkGet([...ids])).filter((c): c is Campaign => !!c);
    const views = (await Promise.all(cps.map(toView))).filter((v): v is CampaignView => !!v);
    return views.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  },
  async campaign(id) {
    const c = await db().campaigns.get(id);
    return c ? toView(c) : undefined;
  },
  async world(id) {
    const w = await db().worlds.get(id);
    return w ? { id: w.id, name: w.name, summary: w.summary } : undefined;
  },
  async character(id) {
    const c = await db().characters.get(id);
    return c ? { id: c.id, name: c.name, avatar: c.avatar, core: c.core } : undefined;
  },
  async characters() {
    return (await db().characters.toArray()).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, core: c.core }));
  },
  async memories(campaignId, opts = {}) {
    const min = opts.minImportance ?? 1;
    const all = await db().memories.where('campaignId').equals(campaignId).filter((m) => m.importance >= min).reverse().sortBy('createdAt');
    return all.slice(0, opts.limit ?? all.length).map((m) => ({ id: m.id, characterId: m.characterId, when: m.when, text: m.text, importance: m.importance, createdAt: m.createdAt }));
  },
  async loreDirectory(campaignId) {
    const c = await db().campaigns.get(campaignId);
    if (!c) return '';
    const [lore, overlays] = await Promise.all([
      db().lore.filter((e) => e.kind !== 'style' && loreApplies(e, c.worldId, c.characterIds)).toArray(),
      db().overlays.where('campaignId').equals(campaignId).toArray(),
    ]);
    return loreDirectory(lore, overlays);
  },
};

import { db } from '../storage/db';
import type { Campaign, Character } from '../storage/db';
import { repo } from './repo';
import { loreApplies } from './lore';
import { loreDirectory } from '../context/assemble';
import { clock } from '../context/clock';
import { places } from './place';
import { stateLines } from '../memory/state';
import { expandMacros } from '../context/macros';
import type { DataView, CampaignView, CharacterView } from '../api/types';

async function toView(c: Campaign): Promise<CampaignView | undefined> {
  const chId = c.characterIds[0];
  const [ch, world, lines, userName] = await Promise.all([chId ? db().characters.get(chId) : undefined, db().worlds.get(c.worldId), stateLines(c.id), repo.userNameOf(c)]);
  if (!ch) return undefined;
  // 库里存的是 {{user}}，插件拿到的一律是这一局的名字
  const x = (t: string) => expandMacros(t, { user: userName, char: ch.name });
  const xs = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, x(v)]));
  // 插件看到的 facts = 状态事件折叠出的行 + 老的 facts，和拼上下文的「当前事实」一致
  const state = { ...structuredClone(c.state), ...(c.state.location ? { location: x(c.state.location) } : {}), relations: xs(c.state.relations), mood: xs(c.state.mood), facts: [...lines, ...c.state.facts].slice(0, 20).map(x) };
  return {
    id: c.id, name: c.name, worldId: c.worldId, worldName: world?.name ?? '', characterId: ch.id, characterName: ch.name,
    lastPlayedAt: c.lastPlayedAt, now: clock.now(c.clock), aligned: clock.aligned(c.clock), ...(ch.timeZone ? { timeZone: ch.timeZone } : {}), userName, state,
  };
}

const charView = (c: Character): CharacterView => ({ id: c.id, name: c.name, avatar: c.avatar, core: c.core, ...(c.timeZone ? { timeZone: c.timeZone } : {}), ...(c.place ? { place: { ...c.place } } : {}) });

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
    return c ? charView(c) : undefined;
  },
  async characters() {
    return (await db().characters.toArray()).map(charView);
  },
  async memories(campaignId, opts = {}) {
    const min = opts.minImportance ?? 1;
    const c = await db().campaigns.get(campaignId);
    const ch = c?.characterIds[0] ? await db().characters.get(c.characterIds[0]) : undefined;
    const names = { user: await repo.userNameOf(c), char: ch?.name ?? '' };
    const all = await db().memories.where('campaignId').equals(campaignId).filter((m) => m.importance >= min).reverse().sortBy('createdAt');
    return all.slice(0, opts.limit ?? all.length).map((m) => ({ id: m.id, characterId: m.characterId, when: expandMacros(m.when, names), text: expandMacros(m.text, names), importance: m.importance, createdAt: m.createdAt }));
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
  userPlace: () => places.user(),
};

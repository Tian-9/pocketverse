import { db } from '../storage/db';
import { repo } from '../data/repo';
import type { Campaign, Character } from '../storage/db';
import type { CatchupContext, CatchupContributor, CatchupItem, CatchupTier } from '../api/types';
import { llm } from '../llm/gateway.svelte';
import { bus } from '../bus/bus';
import { registry } from '../registry/registry.svelte';
import { log } from '../log/log';

const H = 3600_000, D = 24 * H;
/** 档位阈值。TODO：做成设置项。 */
export const TIERS: Record<Exclude<CatchupTier, 'attach'>, number> = { h6: 6 * H, d1: D, days: 2 * D };
const ORDER: Exclude<CatchupTier, 'attach'>[] = ['h6', 'd1', 'days'];
/** 一次回来最多处理几个角色 */
export const BUDGET = 3;

export function tierFor(elapsedMs: number): Exclude<CatchupTier, 'attach'> | null {
  if (elapsedMs >= TIERS.days) return 'days';
  if (elapsedMs >= TIERS.d1) return 'd1';
  if (elapsedMs >= TIERS.h6) return 'h6';
  return null;
}

/** 达到的档位 reached 是否覆盖登记的档位 wanted（高档含低档，attach 总是带上） */
export function covers(reached: Exclude<CatchupTier, 'attach'>, wanted: CatchupTier): boolean {
  if (wanted === 'attach') return true;
  return ORDER.indexOf(reached) >= ORDER.indexOf(wanted);
}

export function elapsedText(ms: number): string {
  if (ms < H) return '不到一小时';
  if (ms >= 2 * D) return `${Math.floor(ms / D)} 天`;
  if (ms >= D) return '一天多';
  return `大约 ${Math.round(ms / H)} 小时`;
}

interface Collected { key: string; item: CatchupItem }

/**
 * 补发：回到前台时，按角色算离开时长、定档位，把各插件登记的事拼成一次模型调用，结果分发回插件。
 * 设计见 docs/ARCHITECTURE.md 5.11。
 */
class Catchup {
  private running = false;

  boot() {
    bus.on('app.resumed', () => { this.run().catch((e) => log.error('catchup', e instanceof Error ? e.message : String(e))); });
  }

  contributors(): { pluginId: string; c: CatchupContributor }[] {
    return registry.plugins.filter((p) => registry.isEnabled(p.id)).flatMap((p) => (p.catchup ?? []).map((c) => ({ pluginId: p.id, c })));
  }

  /** 有没有依附档的登记（决定聊天要不要挂 handle_attached 工具；工具表要稳定，所以只看登记不看有没有事） */
  hasAttach(): boolean {
    return this.contributors().some((x) => x.c.tier === 'attach');
  }

  /** 聊天回复前收集依附的事：挂在这一轮上处理 */
  async collectAttached(cp: Campaign, ch: Character, now = Date.now()): Promise<{ key: string; item: CatchupItem; ctx: CatchupContext }[]> {
    const elapsedMs = Math.max(0, now - cp.lastPlayedAt);
    const ctx: CatchupContext = { campaignId: cp.id, characterId: ch.id, characterName: ch.name, elapsedMs, days: Math.floor(elapsedMs / D), tier: 'chat', elapsedText: elapsedText(elapsedMs) };
    const out: { key: string; item: CatchupItem; ctx: CatchupContext }[] = [];
    for (const { pluginId, c } of this.contributors()) {
      if (c.tier !== 'attach') continue;
      try {
        const item = await c.collect(ctx);
        if (item) out.push({ key: `${pluginId}_${c.id}`, item, ctx });
      } catch (e) { log.warn('catchup', `${pluginId}/${c.id} 收集失败：${e instanceof Error ? e.message : String(e)}`); }
    }
    return out;
  }

  async run(now = Date.now()) {
    if (this.running) { log.info('catchup', '跳过：上一次还在进行'); return; }
    if (!llm.configured) return;
    const contributors = this.contributors();
    if (!contributors.length) return;
    this.running = true;
    try {
      // 只补当前这一局：同一张卡在别的世界的局先睡着
      const current = await repo.currentCampaignIds();
      const campaigns = (await db().campaigns.orderBy('lastPlayedAt').reverse().toArray()).filter((c) => c.lastPlayedAt > 0 && current.has(c.id));
      let budget = BUDGET;
      for (const cp of campaigns) {
        if (budget <= 0) break;
        const elapsed = now - Math.max(cp.lastPlayedAt, cp.catchupAt ?? 0);
        const tier = tierFor(elapsed);
        if (!tier) continue;
        const ch = cp.characterIds[0] ? await db().characters.get(cp.characterIds[0]) : undefined;
        if (!ch) continue;
        budget--;
        await this.runFor(cp, ch, tier, elapsed, contributors, now).catch((e) => log.error('catchup', `${ch.name}：${e instanceof Error ? e.message : String(e)}`, { campaignId: cp.id }));
      }
    } finally { this.running = false; }
  }

  async runFor(cp: Campaign, ch: Character, tier: Exclude<CatchupTier, 'attach'>, elapsedMs: number, contributors: { pluginId: string; c: CatchupContributor }[], now: number) {
    const ctx: CatchupContext = { campaignId: cp.id, characterId: ch.id, characterName: ch.name, elapsedMs, days: Math.floor(elapsedMs / D), tier, elapsedText: elapsedText(elapsedMs) };
    const items: Collected[] = [];
    for (const { pluginId, c } of contributors) {
      if (!covers(tier, c.tier)) continue;
      try {
        const item = await c.collect(ctx);
        if (item) items.push({ key: `${pluginId}_${c.id}`, item });
      } catch (e) { log.warn('catchup', `${pluginId}/${c.id} 收集失败：${e instanceof Error ? e.message : String(e)}`); }
    }
    // 没事也记一下时间，不然下次回来还按同一段离开时长再算一遍
    await db().campaigns.update(cp.id, { catchupAt: now });
    if (!items.length) { log.info('catchup', `${ch.name}：${tier} 档，没有要处理的事`, { campaignId: cp.id }); return; }
    log.info('catchup', `${ch.name}：${tier} 档（离开 ${ctx.elapsedText}），处理 ${items.map((i) => i.item.label).join('、')}`, { campaignId: cp.id, keys: items.map((i) => i.key) });

    const mems = await db().memories.where('campaignId').equals(cp.id).reverse().sortBy('createdAt');
    const system = `你是「${ch.name}」。设定：${ch.core.slice(0, 800)}
你有一阵没碰手机了，现在拿起手机处理几件事。每件事按它的说明回答，用中文，按给定的 JSON 结构输出。
保持角色的口吻，像真人用手机：短、口语、不解释。不要提到"用户"这个词，称呼对方用你平时的叫法。不想做的事可以不做，各段说明里写了怎么表示。`;
    const user = [
      `# 情况\n对方离开了${ctx.elapsedText}。现在是 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}。\n你现在的情绪：${cp.state.mood[ch.id] ?? '平常'}\n最近记得的事：\n${mems.slice(0, 6).map((m) => '- ' + m.text).join('\n') || '（没什么特别的）'}`,
      '# 要处理的事',
      ...items.map(({ key, item }) => `## ${item.label}（字段 ${key}）\n${item.prompt}`),
    ].join('\n\n');
    const schema = {
      type: 'object', additionalProperties: false, required: items.map((i) => i.key),
      properties: Object.fromEntries(items.map((i) => [i.key, i.item.schema])),
    };
    const r = await llm.chat({
      purpose: 'catchup', effort: 'low', maxTokens: 1500, jsonSchema: schema,
      system: [{ type: 'text', text: system }], messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    });
    let out: Record<string, unknown>;
    try { out = JSON.parse(r.text) as Record<string, unknown>; }
    catch { log.error('catchup', `${ch.name}：模型没有返回合法 JSON`, { campaignId: cp.id, stopReason: r.stopReason, head: r.text.slice(0, 120) }); return; }
    const done: string[] = [];
    for (const { key, item } of items) {
      try { await item.apply(out[key], ctx); done.push(key); }
      catch (e) { log.error('catchup', `${key} 落库失败：${e instanceof Error ? e.message : String(e)}`, { campaignId: cp.id }); }
    }
    bus.emit('catchup.done', { campaignId: cp.id, tier, keys: done });
  }
}

export const catchup = new Catchup();

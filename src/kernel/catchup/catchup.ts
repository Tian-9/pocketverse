import { db } from '../storage/db';
import { repo } from '../data/repo';
import type { Campaign, Character } from '../storage/db';
import type { CatchupContext, CatchupContributor, CatchupItem, CatchupTier } from '../api/types';
import { llm } from '../llm/gateway.svelte';
import { bus } from '../bus/bus';
import { registry } from '../registry/registry.svelte';
import { scheduler } from '../scheduler/scheduler';
import { log } from '../log/log';
import { wakes, wakeItem, userRepliedSince, KEY as WAKE_KEY } from './wake';
import { timeLine } from '../context/time';
import { clock } from '../context/clock';

const H = 3600_000, D = 24 * H;
/** 档位阈值。TODO：做成设置项。 */
export const TIERS: Record<Exclude<CatchupTier, 'attach'>, number> = { h6: 6 * H, d1: D, days: 2 * D };
const ORDER: Exclude<CatchupTier, 'attach'>[] = ['h6', 'd1', 'days'];
/** 一次回来最多处理几个角色 */
export const BUDGET = 3;
/** 前台开着的时候也每隔这么久查一次：不然网页挂一天，谁也不会动 */
export const TICK = 60 * 60_000;

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
/** 一次补发覆盖的剧情时段：from 上次互动 / 补发，to 剧情此刻；real 是真实的现在（落库、定时器用） */
interface Span { from: number; to: number; real: number; skipped?: boolean }

/** 上次互动或上次补发时的剧情时刻。旧数据没有 playedStoryTs 就按时钟倒推 lastPlayedAt 那一刻 */
export function lastStoryTs(cp: Campaign): number {
  return Math.max(cp.playedStoryTs ?? clock.now(cp.clock, cp.lastPlayedAt), cp.catchupStoryTs ?? 0);
}

/**
 * 补发：回到前台时，按角色算离开时长、定档位，把各插件登记的事拼成一次模型调用，结果分发回插件。
 * 设计见 docs/ARCHITECTURE.md 5.11。
 */
class Catchup {
  private running = false;
  private stopWake: (() => void) | null = null;
  private kick = () => { this.run().catch((e) => log.error('catchup', e instanceof Error ? e.message : String(e))); };

  boot() {
    // 前台定时器切到后台会被清掉，回到前台先补一次，再重新上表
    let stop: (() => void) | null = null;
    const arm = () => { stop?.(); stop = scheduler.every(TICK, this.kick); };
    bus.on('app.resumed', () => { this.kick(); arm(); });
    arm();
    this.armWake().catch(() => {});
  }

  /**
   * 角色定的"稍后联系"是分钟级的，等不了每小时一次的 tick：按最早到点的那件排一个一次性定时器。
   * 定了新的、跑完一轮、回到前台都重排一次；切到后台定时器被清掉，回来 run() 里会先查一遍到点的。
   * fireAt 是剧情时刻：走表的局换算成真实的几分钟后；停表的局不排定时器，用户一跳过时间就到点（见 skipped）。
   */
  async armWake(now = Date.now()) {
    this.stopWake?.(); this.stopWake = null;
    const current = await repo.currentCampaignIds();
    let next: number | null = null;
    for (const w of await wakes.all()) {
      if (!current.has(w.campaignId)) continue;
      const cp = await db().campaigns.get(w.campaignId);
      if (!cp || cp.clock?.running === false) continue;
      const realAt = now + (w.fireAt - clock.now(cp.clock, now));
      if (next === null || realAt < next) next = realAt;
    }
    if (next === null) return;
    this.stopWake = scheduler.after(Math.max(1000, next - now), this.kick);
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
    const to = clock.now(cp.clock, now), from = Math.min(to, lastStoryTs(cp));
    const elapsedMs = to - from;
    const ctx: CatchupContext = { campaignId: cp.id, characterId: ch.id, characterName: ch.name, elapsedMs, from, to, now: to, days: Math.floor(elapsedMs / D), tier: 'chat', elapsedText: elapsedText(elapsedMs) };
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
        // 离开时长按剧情钟算：走表的局就是真实时长，停表的局你不来他一秒没过
        const to = clock.now(cp.clock, now), from = Math.min(to, lastStoryTs(cp));
        if (await this.once(cp, { from, to, real: now }, contributors)) budget--;
      }
    } finally { this.running = false; }
    this.armWake(now).catch(() => {});
  }

  /**
   * 用户在聊天里推进时间：他也过了这段时间。跳三天就是 days 档，朋友圈、日记、回评论一次补齐，再接着聊。
   * 由 advanceTime 在拨完时钟、写旁白之前调用。
   */
  async skipped(campaignId: string, from: number, to: number, real = Date.now()) {
    if (this.running || !llm.configured) return;
    const cp = await db().campaigns.get(campaignId);
    if (!cp) return;
    this.running = true;
    try { await this.once(cp, { from, to, real, skipped: true }, this.contributors()); }
    finally { this.running = false; }
    this.armWake(real).catch(() => {});
  }

  /** 一个角色一次：定档、看"稍后联系"到没到点，有事就调一次模型。返回有没有真的处理 */
  private async once(cp: Campaign, span: Span, contributors: { pluginId: string; c: CatchupContributor }[]): Promise<boolean> {
    const elapsed = Math.max(0, span.to - span.from);
    const tier = tierFor(elapsed);
    // 角色自己定的"稍后联系"到点了也算一次"拿起手机"，没到档也跑，到档了就和插件的事拼成同一次调用
    let wake = await wakes.get(cp.id);
    if (wake && wake.fireAt > span.to) wake = null;
    if (wake?.onlyIfSilent && (await userRepliedSince(wake))) { await wakes.clear(cp.id); wake = null; }
    if (!tier && !wake) {
      // 跳过了一小段：没到档也记下，免得下次把这段再算一遍
      if (span.skipped) await db().campaigns.update(cp.id, { catchupStoryTs: span.to });
      return false;
    }
    const ch = cp.characterIds[0] ? await db().characters.get(cp.characterIds[0]) : undefined;
    if (!ch) { if (wake) await wakes.clear(cp.id); return false; }
    const extra: Collected[] = wake ? [{ key: WAKE_KEY, item: wakeItem(wake, span.to, ch.timeZone, !clock.aligned(cp.clock, span.real)) }] : [];
    await this.runFor(cp, ch, tier, span, contributors, extra).catch((e) => log.error('catchup', `${ch.name}：${e instanceof Error ? e.message : String(e)}`, { campaignId: cp.id }));
    if (wake) await wakes.clear(cp.id);
    return true;
  }

  async runFor(cp: Campaign, ch: Character, tier: Exclude<CatchupTier, 'attach'> | null, span: Span, contributors: { pluginId: string; c: CatchupContributor }[], extra: Collected[] = []) {
    const elapsedMs = Math.max(0, span.to - span.from);
    const ctx: CatchupContext = { campaignId: cp.id, characterId: ch.id, characterName: ch.name, elapsedMs, from: span.from, to: span.to, now: span.to, ...(span.skipped ? { skipped: true } : {}), days: Math.floor(elapsedMs / D), tier: tier ?? 'wake', elapsedText: elapsedText(elapsedMs) };
    const items: Collected[] = [...extra];
    for (const { pluginId, c } of contributors) {
      // 没到档（只是"稍后联系"到点）时只带依附档的事
      if (!(c.tier === 'attach' || (tier && covers(tier, c.tier)))) continue;
      try {
        const item = await c.collect(ctx);
        if (item) items.push({ key: `${pluginId}_${c.id}`, item });
      } catch (e) { log.warn('catchup', `${pluginId}/${c.id} 收集失败：${e instanceof Error ? e.message : String(e)}`); }
    }
    // 没事也记一下时间，不然下次回来还按同一段离开时长再算一遍
    await db().campaigns.update(cp.id, { catchupAt: span.real, catchupStoryTs: span.to });
    if (!items.length) { log.info('catchup', `${ch.name}：${ctx.tier} 档，没有要处理的事`, { campaignId: cp.id }); return; }
    log.info('catchup', `${ch.name}：${ctx.tier} 档（离开 ${ctx.elapsedText}），处理 ${items.map((i) => i.item.label).join('、')}`, { campaignId: cp.id, keys: items.map((i) => i.key) });

    const mems = await db().memories.where('campaignId').equals(cp.id).reverse().sortBy('createdAt');
    const userName = await db().getKV('kernel.userName', '我');
    const system = `你是「${ch.name}」。设定：${ch.core.slice(0, 800)}${cp.userPersona?.trim() ? `\n对方「${userName}」在这个世界里是：${cp.userPersona.trim()}` : ''}
${tier ? '你有一阵没碰手机了，现在拿起手机处理几件事。' : '你之前记下过晚点要联系对方，现在到时间了，拿起手机。'}每件事按它的说明回答，用中文，按给定的 JSON 结构输出。
保持角色的口吻，像真人用手机：短、口语、不解释。不要提到"用户"这个词，称呼对方用你平时的叫法。不想做的事可以不做，各段说明里写了怎么表示。`;
    const user = [
      `# 情况\n${tier ? `${span.skipped ? '过去了' : '对方离开了'}${ctx.elapsedText}。` : `你们上次聊是${ctx.elapsedText}前。`}${timeLine(new Date(span.to), ch.timeZone, undefined, !clock.aligned(cp.clock, span.real))}\n你现在的情绪：${cp.state.mood[ch.id] ?? '平常'}\n最近记得的事：\n${mems.slice(0, 6).map((m) => '- ' + m.text).join('\n') || '（没什么特别的）'}`,
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
    bus.emit('catchup.done', { campaignId: cp.id, tier: ctx.tier, keys: done });
  }
}

export const catchup = new Catchup();

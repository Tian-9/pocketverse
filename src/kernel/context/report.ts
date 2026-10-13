import type { StateSetEvent } from 'annals/airp';
import { liveEntries, stateView } from 'annals/airp';
import type { Campaign, Character, EpisodicMemory, LoreEntry, LoreOverlay, MemFile, Message, World } from '../storage/db';
import type { ChatMessage, TextBlock } from '../llm/types';
import type { AssembleInput } from './assemble';
import { loreApplies } from '../data/lore';
import { triggerL1 } from './l1';
import { estimateTokens } from './tokens';
import { fromUserMacro } from './userref';

/**
 * 「导出这一局的上下文」的报告：下一轮实际会发的请求，加上每样设定进了哪里、没进的原因。
 * 纯函数，材料由聊天引擎的 prepare() 给，和真实发送用的是同一份。
 */
export interface ReportInput {
  character: Character;
  campaign: Campaign;
  world: World;
  worlds: World[];
  /** 库里全部条目（含别的世界、别的角色的），用来解释"为什么没进" */
  allLore: LoreEntry[];
  overlays: LoreOverlay[];
  /** 这一局全部情节记忆，新的在前 */
  memories: EpisodicMemory[];
  memfs: MemFile[];
  stateEvents: StateSetEvent[];
  input: AssembleInput;
  assembled: { system: TextBlock[]; messages: ChatMessage[]; l1Hits: string[]; l1Scan: string; recent: Message[] };
  toolNames: string[];
  useTools: boolean;
  contributions: { source: string; kind: 'stable' | 'volatile'; text: string }[];
  /** gate.render() 渲染的完整请求 */
  request: string;
  settings: { model: string; effort: string; tools: boolean; web: boolean; preview: boolean };
}

export type Placement = 'system' | 'tail' | 'directory' | 'tool-only' | 'none';
export interface LoreRow { entry: LoreEntry; placement: Placement; where: string; notes: string[] }

const has = (names: string[], n: string) => names.includes(n);

/** 每条适用的条目进了哪里。不适用的（别的世界、别的角色）不在这里，另算。 */
export function classifyLore(r: Pick<ReportInput, 'input' | 'assembled' | 'toolNames' | 'useTools'>): LoreRow[] {
  const { input, assembled } = r;
  const active = input.overlays.filter((o) => !o.pending);
  const fitted = new Set(triggerL1(input.lore, active, { scanText: assembled.l1Scan, budgetTokens: input.l1Budget }).map((h) => h.entry.id));
  const matched = new Set(triggerL1(input.lore, active, { scanText: assembled.l1Scan, budgetTokens: Number.POSITIVE_INFINITY }).map((h) => h.entry.id));
  const canRead = r.useTools && has(r.toolNames, 'lore_read');
  const rows: LoreRow[] = [];
  for (const e of [...input.lore].sort((a, b) => a.order - b.order)) {
    const notes: string[] = [];
    const ov = input.overlays.find((o) => o.loreEntryId === e.id);
    if (ov && !ov.pending) notes.push('本局有覆盖，用的是覆盖版正文');
    if (ov?.pending) notes.push('有一条待确认的变化，采纳前不生效');
    const noTrigger = !e.triggers.keywords.some((k) => k.trim()) && !e.triggers.regex?.trim();
    const l1 = () => {
      if (fitted.has(e.id)) return '这一轮关键词命中，全文进最后一条消息';
      if (matched.has(e.id)) { notes.push(`命中了，但 L1 预算（${input.l1Budget ?? 4000} token）放不下，被丢了`); return '命中但超预算'; }
      if (noTrigger) { notes.push('既不常驻也没有关键词或正则：永远不会自动进'); return '不会自动进'; }
      return '这一轮没命中关键词（聊到才进）';
    };
    if (!e.enabled) { rows.push({ entry: e, placement: 'none', where: '关闭了', notes }); continue; }
    if (e.kind === 'style') {
      if (e.constant) rows.push({ entry: e, placement: e.position === 'tail' ? 'tail' : 'system', where: e.position === 'tail' ? '尾部指令：每轮进最后一条消息' : 'system：写作风格，每轮', notes });
      else { const w = l1(); rows.push({ entry: e, placement: fitted.has(e.id) ? 'tail' : 'none', where: `风格（触发式）：${w}`, notes }); }
      continue;
    }
    if (e.constant) { rows.push({ entry: e, placement: 'system', where: 'system：世界书常驻，全文每轮', notes }); continue; }
    const w = l1();
    if (!e.summary.trim()) notes.push('摘要是空的，目录里只有标题，模型很难知道要不要去读');
    if (!fitted.has(e.id)) notes.push(canRead ? '全文要靠模型自己调 lore_read 读' : '工具关了，模型读不到全文');
    rows.push({ entry: e, placement: fitted.has(e.id) ? 'tail' : 'directory', where: `目录（标题+摘要每轮）；${w}`, notes });
  }
  return rows;
}

const block = (s: string, lang = '') => '```' + lang + '\n' + s.replace(/```/g, '`​``') + '\n```';
const one = (s: string, n = 60) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function buildReport(r: ReportInput): string {
  const { character: ch, campaign: cp, world, input, assembled } = r;
  const out: string[] = [];
  const canTool = (n: string) => r.useTools && has(r.toolNames, n);
  const tok = (s: string) => estimateTokens(s);
  const systemTokens = assembled.system.reduce((a, b) => a + tok(b.text), 0);
  const msgTokens = assembled.messages.reduce((a, m) => a + m.content.reduce((x, b) => x + (b.type === 'text' ? tok(b.text) : 0), 0), 0);

  out.push(`# ${ch.name} · 上下文排查`, '');
  out.push(`这一局：「${cp.name}」，世界「${world.name}」，你在这局叫「${input.userName}」。下面是**下一轮聊天实际会发的请求**（还没发，你下一句话没算进去），以及每样设定进了哪里、没进的原因。`, '');
  out.push('## 一眼看', '');
  out.push('| 项 | 值 |', '|---|---|');
  out.push(`| 对话档模型 | ${r.settings.model} · ${r.settings.effort} |`);
  out.push(`| 工具 | ${r.settings.tools ? `开（${r.toolNames.length} 个）` : '**关**：世界书全文、完整设定、非三星记忆模型都读不到'} |`);
  out.push(`| 联网 | ${r.settings.web ? '开' : '关'} |`);
  out.push(`| system 估算 | 约 ${systemTokens.toLocaleString()} token，${assembled.system.length} 块 |`);
  out.push(`| 消息估算 | 约 ${msgTokens.toLocaleString()} token，${assembled.messages.length} 条 |`);
  out.push(`| 历史 | 共 ${input.history.length} 条，窗口和章节截断后用 ${assembled.recent.length} 条 |`);
  out.push(`| L1 命中 | ${assembled.l1Hits.length ? assembled.l1Hits.join('、') : '无'} |`, '');

  // ---- system 块 ----
  out.push('## system 各块', '');
  out.push('| # | 标题 | 约 token | 缓存断点 |', '|---|---|---|---|');
  assembled.system.forEach((b, i) => out.push(`| ${i + 1} | ${cell(b.text.split('\n')[0]!.slice(0, 40))} | ${tok(b.text)} | ${b.cache ? '是' : ''} |`));
  out.push('');

  // ---- 角色卡 ----
  out.push('## 角色卡', '');
  out.push('| 字段 | 长度 | 进了哪里 |', '|---|---|---|');
  out.push(`| 核心设定 core | ${ch.core.length} 字 | system「你扮演的角色」，每轮全文 |`);
  out.push(`| 完整设定 full | ${ch.full.length} 字 | ${ch.full.trim() ? (canTool('character_read') ? '**不常驻**，模型要调 character_read 才看得到' : '**看不到**：工具关了') : '空'} |`);
  out.push(`| 开场白 | ${(ch.firstMessage ?? '').length} 字 | ${ch.useFirstMessage ? '新对话时作为他的第一条消息，之后就是普通历史' : '不自动发，不进上下文'} |`);
  out.push(`| 所在城市 / 时区 | ${ch.place?.name ?? '和你一样'} / ${ch.timeZone ?? '和你一样'} | 最后一条消息的时间行 |`, '');

  // ---- 世界书 ----
  const rows = classifyLore(r);
  out.push('## 世界书 · 人物背景 · 风格', '');
  out.push('适用规则：这局所在世界的条目 + 他的人物背景 + 全局风格。下面是适用的；不适用的在后面单列。', '');
  if (rows.length) {
    out.push('| 条目 | 类型 | 进了哪里 | 提醒 |', '|---|---|---|---|');
    for (const row of rows) {
      const e = row.entry;
      const kind = e.kind === 'style' ? '风格' : e.characterIds?.length ? '人物背景' : '世界书';
      out.push(`| ${cell(e.title)} | ${kind} | ${cell(row.where)} | ${cell(row.notes.join('；'))} |`);
    }
  } else out.push('（没有适用的条目）');
  out.push('');
  const elsewhere = r.allLore.filter((e) => !loreApplies(e, world.id, [ch.id]));
  if (elsewhere.length) {
    const otherChar = elsewhere.filter((e) => e.characterIds?.length);
    const byWorld = new Map<string, number>();
    for (const e of elsewhere) if (!e.characterIds?.length) byWorld.set(e.worldId, (byWorld.get(e.worldId) ?? 0) + 1);
    out.push('不适用、不会进的：', '');
    for (const [wid, n] of byWorld) out.push(`- 世界「${r.worlds.find((w) => w.id === wid)?.name ?? wid}」的 ${n} 条（这局在「${world.name}」）`);
    if (otherChar.length) out.push(`- 别的角色的人物背景 ${otherChar.length} 条`);
    out.push('');
  }
  const extraOverlays = r.overlays.filter((o) => !o.loreEntryId);
  if (extraOverlays.length) {
    out.push('本局新增的世界变化：', '');
    for (const o of extraOverlays) out.push(`- ${o.title}：${o.pending ? '待确认，不生效' : '目录里有标题+摘要，全文要 lore_read'}`);
    out.push('');
  }

  // ---- 状态 ----
  const view = stateView(r.stateEvents);
  const live = liveEntries(view);
  const injected = new Set(input.stateLines ?? []);
  out.push('## 当前状态与硬事实', '');
  out.push(`最后一条消息里的「当前状态」（每轮重算，不占缓存）：地点、关系、情绪、拍一拍，加 ${injected.size} 条硬事实和 ${cp.state.facts.length} 条老事实。`, '');
  if (live.length) {
    out.push('| 硬事实 | 值 | 来源 | 进了吗 |', '|---|---|---|---|');
    for (const e of live) {
      const line = `${e.payload.entity} · ${e.payload.attr}：${e.payload.value}`;
      out.push(`| ${cell(e.payload.entity)} · ${cell(e.payload.attr)} | ${cell(e.payload.value)} | ${cell(e.source ?? '')} | ${injected.has(line) ? '进' : '**没进**：超过 20 条，按最近写入淘汰了'} |`);
    }
    out.push('');
  }
  out.push(`状态事件共 ${r.stateEvents.length} 条（含被覆盖和清除的历史）。`, '');

  // ---- 记忆 ----
  const hi = new Set(input.highlights.map((m) => m.id));
  const rc = new Set((input.recalled ?? []).map((m) => m.id));
  const named = (t: string) => fromUserMacro(t, input.userName, ch.name);
  const threeStar = r.memories.filter((m) => m.importance === 3).length;
  out.push('## 情节记忆', '');
  out.push(`共 ${r.memories.length} 条，三星 ${threeStar} 条。最后一条消息里的「近期要事」只有最近 10 条三星；其余每轮用你刚说的话自动搜，最多 3 条进最后一条消息（这一轮召回了 ${rc.size} 条）；再往外${canTool('memory_search') ? '要模型调 memory_search / memory_recent' : '**模型看不到**（工具关了）'}。`, '');
  if (r.memories.length) {
    out.push('| 记忆 | 星 | 词袋 | 进了吗 |', '|---|---|---|---|');
    for (const m of r.memories) {
      const bag = m.bag ? [...(m.bag.core ?? []), ...(m.bag.related ?? [])].slice(0, 6).join('、') : '（无，按正文分词）';
      out.push(`| ${cell(one(named(`${m.when ? m.when + '：' : ''}${m.text}`)))} | ${m.importance} | ${cell(named(bag))} | ${hi.has(m.id) ? '近期要事' : rc.has(m.id) ? '这一轮自动召回' : m.importance === 3 ? '三星但不在最近 10 条' : '只能搜'} |`);
    }
    out.push('');
  }

  // ---- 笔记 ----
  out.push('## 他的笔记 /memories', '');
  if (r.memfs.length) {
    out.push('每轮进 system，单文件 1500 字、总共 4000 字，超了截断。', '');
    for (const f of [...r.memfs].sort((a, b) => a.path.localeCompare(b.path))) out.push(`- ${f.path}：${f.content.trim().length} 字${f.content.trim().length > 1500 ? '（超单文件上限，截断）' : ''}`);
  } else out.push('（没有）');
  out.push('');

  // ---- 插件 ----
  out.push('## 插件贡献', '');
  if (r.contributions.length) {
    out.push('| 来源 | 位置 | 内容 |', '|---|---|---|');
    for (const c of r.contributions) out.push(`| ${c.source} | ${c.kind === 'stable' ? 'system 末尾' : '最后一条消息'} | ${c.text.trim() ? cell(one(c.text, 80)) : '（空，没进）'} |`);
  } else out.push('（没有）');
  out.push('', '「顺手处理的事」（回朋友圈评论之类）导出时没收集，免得触发插件；真实发送时会有。', '');

  // ---- 历史 ----
  out.push('## 历史消息', '');
  const dropped = input.history.length - assembled.recent.length;
  out.push(`共 ${input.history.length} 条。${dropped > 0 ? `窗口（最近 ${input.windowSize ?? 60} 条）和章节分隔（推进时间之前只留 ${input.chapterTail ?? 6} 条衔接）截掉了 ${dropped} 条，那之前的事靠记忆。` : '全部在窗口内。'}旁白和系统提示（role=system）不进；空消息不进。`, '');

  // ---- 完整请求 ----
  out.push('## 完整请求（和发送前预览一样）', '', block(r.request), '');

  // ---- 原始设定 ----
  out.push('## 原始设定', '');
  const { avatar: _a, ...card } = ch;
  out.push('### 角色卡', '', block(JSON.stringify(card, null, 2), 'json'), '');
  out.push('### 存档', '', block(JSON.stringify({ ...cp }, null, 2), 'json'), '');
  out.push('### 适用的条目', '', block(JSON.stringify(input.lore, null, 2), 'json'), '');
  if (r.overlays.length) out.push('### 本局覆盖', '', block(JSON.stringify(r.overlays, null, 2), 'json'), '');
  out.push('### 状态事件', '', block(r.stateEvents.map((e) => JSON.stringify(e)).join('\n') || '（无）', 'jsonl'), '');
  return out.join('\n');
}

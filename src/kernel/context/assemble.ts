import type { ChatMessage, TextBlock } from '../llm/types';
import type { Campaign, Character, EpisodicMemory, LoreEntry, LoreOverlay, Message, World } from '../storage/db';
import { textOf } from '../data/repo';
import { triggerL1 } from './l1';
import { expandMacros } from './macros';

export interface AssembleInput {
  world: World;
  campaign: Campaign;
  /** 在场角色 */
  characters: Character[];
  userName: string;
  userProfile?: string;
  lore: LoreEntry[];
  overlays: LoreOverlay[];
  /** 近期要事（importance 高的情节记忆，已按时间排序） */
  highlights: EpisodicMemory[];
  /** memory 工具目录（空字符串表示没有） */
  memoryIndex?: string;
  history: Message[];
  /** 本轮用户输入；为空表示让角色接着说（重新生成） */
  userText?: string;
  /** 插件注入：稳定部分进 system，易变部分进最后一条用户消息 */
  pluginStable?: string[];
  pluginVolatile?: string[];
  now?: Date;
  windowSize?: number;
  l1Budget?: number;
  /** 扫描最近几条消息做 L1 触发 */
  scanDepth?: number;
  hasTools?: boolean;
  /** 自定义对话规则，空则用默认 */
  rules?: string;
}

export const DEFAULT_RULES = [
  '你在扮演一个角色，和用户进行沉浸式的文字角色扮演。',
  '始终以角色的身份、口吻和视角说话，不要跳出角色解释自己是 AI。',
  '回复像手机聊天：一次一到三段，口语化，长度和对方匹配，不要独白。',
  '不要替用户说话或决定用户的行动。',
  '用中文回复，除非角色设定要求其他语言。',
].join('\n');

const TOOL_RULES = [
  '你有一些工具可以查资料和记事：',
  '- 世界书目录列在下面。目录里有的条目，当对话确实需要细节时用 lore_read 读正文，不要每轮都查。',
  '- 想不起来以前发生过什么时用 memory_search 或 memory_recent。',
  '- 关系、情绪、地点或当前事实发生明确变化时，用 state_update 记下来。',
  '- 剧情让世界本身发生了变化（某个地方毁了、某条规则被打破）时，用 overlay_write 记下来，不要假装世界书没变。',
  '- /memories 目录是你自己的笔记本，用 memory 工具维护。回复前先看一眼目录里有没有相关的文件；用户说了值得长期记住的事就写进去。',
  '查完资料后正常回复，不要向用户复述你查了什么。',
].join('\n');

function section(title: string, body: string | undefined): TextBlock | null {
  const b = body?.trim();
  return b ? { type: 'text', text: `# ${title}\n${b}` } : null;
}

export function loreDirectory(lore: LoreEntry[], overlays: LoreOverlay[]): string {
  const byId = new Map(overlays.filter((o) => o.loreEntryId && !o.pending).map((o) => [o.loreEntryId!, o]));
  const lines = lore.filter((e) => e.enabled).sort((a, b) => a.order - b.order).map((e) => {
    const ov = byId.get(e.id);
    return `- [${e.id}] ${e.title}：${ov ? `${ov.summary || e.summary}（本局已变化，原为：${e.summary}）` : e.summary}`;
  });
  for (const o of overlays) if (!o.loreEntryId && !o.pending) lines.push(`- [${o.id}] ${o.title}：${o.summary}（本局新增）`);
  return lines.join('\n');
}

function stateText(c: Campaign, chars: Character[]): string {
  const s = c.state;
  const name = (id: string) => chars.find((x) => x.id === id)?.name ?? id;
  const parts: string[] = [];
  if (s.inWorldTime) parts.push(`剧情时间：${s.inWorldTime}`);
  if (s.location) parts.push(`地点：${s.location}`);
  for (const [id, v] of Object.entries(s.relations)) parts.push(`${name(id)} 与用户的关系：${v}`);
  for (const [id, v] of Object.entries(s.mood)) parts.push(`${name(id)} 现在的情绪：${v}`);
  if (s.facts.length) parts.push('当前事实：\n' + s.facts.map((f) => `- ${f}`).join('\n'));
  return parts.join('\n');
}

/**
 * 拼装请求。顺序固定：规则 → 用户 → 世界 → 角色 → 状态 → 世界书目录 → 近期要事 → 记忆目录 → 插件稳定部分。
 * 缓存断点两处：system 末尾、倒数第二条消息末尾。易变内容只进最后一条用户消息。
 */
export function assemble(input: AssembleInput): { system: TextBlock[]; messages: ChatMessage[]; l1Hits: string[] } {
  const { windowSize = 60, scanDepth = 4, now = new Date() } = input;
  const isStyle = (e: LoreEntry) => e.kind === 'style';
  const loreOnly = input.lore.filter((e) => !isStyle(e));
  const constant = loreOnly.filter((e) => e.enabled && e.constant).sort((a, b) => a.order - b.order);
  const constantStyle = input.lore.filter((e) => isStyle(e) && e.enabled && e.constant).sort((a, b) => a.order - b.order);

  const system = [
    section('规则', (input.rules?.trim() || DEFAULT_RULES) + (input.hasTools ? '\n\n' + TOOL_RULES : '')),
    constantStyle.length ? section('写作风格与附加指令', constantStyle.map((e) => `## ${e.title}\n${e.content}`).join('\n\n')) : null,
    section('用户', `用户的名字是「${input.userName}」。${input.userProfile ? '\n' + input.userProfile : ''}`),
    section(`世界：${input.world.name}`, input.world.summary),
    ...input.characters.map((c) => section(input.characters.length > 1 ? `角色：${c.name}` : `你扮演的角色：${c.name}`, c.core)),
    section('当前状态', stateText(input.campaign, input.characters)),
    constant.length ? section('世界书（常驻）', constant.map((e) => `## ${e.title}\n${e.content}`).join('\n\n')) : null,
    section('世界书目录', loreDirectory(loreOnly.filter((e) => !e.constant), input.overlays)),
    input.highlights.length ? section('近期要事', input.highlights.map((m) => `- ${m.when ? m.when + '：' : ''}${m.text}`).join('\n')) : null,
    section('你的记忆目录 /memories', input.memoryIndex),
    ...(input.pluginStable ?? []).map((t) => (t.trim() ? ({ type: 'text', text: t } as TextBlock) : null)),
  ].filter((b): b is TextBlock => !!b);
  system[system.length - 1]!.cache = true;

  const recent = input.history.slice(-windowSize);
  const messages: ChatMessage[] = [];
  for (const m of recent) {
    if (m.role === 'system') continue;
    const text = textOf(m).trim();
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content.push({ type: 'text', text });
    else messages.push({ role: m.role, content: [{ type: 'text', text }] });
  }

  // L1：扫最近几条消息 + 本轮输入
  const scan = [...recent.slice(-scanDepth).map(textOf), input.userText ?? ''].join('\n');
  const hits = triggerL1(input.lore, input.overlays.filter((o) => !o.pending), { scanText: scan, budgetTokens: input.l1Budget });

  const tail: string[] = [];
  const styleHits = hits.filter((h) => isStyle(h.entry));
  const loreHits = hits.filter((h) => !isStyle(h.entry));
  if (styleHits.length) tail.push('<风格>\n' + styleHits.map((h) => `## ${h.entry.title}\n${h.entry.content}`).join('\n\n') + '\n</风格>');
  if (loreHits.length) tail.push('<世界书>\n' + loreHits.map((h) => `## ${h.entry.title}${h.overlaid ? '（本局已变化）' : ''}\n${h.content}`).join('\n\n') + '\n</世界书>');
  tail.push(...(input.pluginVolatile ?? []).filter((t) => t.trim()));
  tail.push(`现在是 ${now.toLocaleString('zh-CN', { hour12: false })}。`);
  if (input.userText?.trim()) tail.push(input.userText.trim());

  const last = messages[messages.length - 1];
  if (last?.role === 'user') last.content.push({ type: 'text', text: tail.join('\n\n') });
  else messages.push({ role: 'user', content: [{ type: 'text', text: tail.join('\n\n') }] });

  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: [{ type: 'text', text: '（对话开始）' }] });

  if (messages.length >= 2) {
    const prev = messages[messages.length - 2]!;
    const pb = prev.content[prev.content.length - 1]!;
    if (pb.type === 'text') pb.cache = true;
  }
  // 酒馆占位符：{{user}} / {{char}} → 名字。只在拼装时替换，数据里保留原样。
  const names = { user: input.userName, char: input.characters[0]?.name ?? '角色' };
  for (const b of system) b.text = expandMacros(b.text, names);
  for (const m of messages) for (const b of m.content) if (b.type === 'text') b.text = expandMacros(b.text, names);
  return { system, messages, l1Hits: loreHits.map((h) => h.entry.title) };
}

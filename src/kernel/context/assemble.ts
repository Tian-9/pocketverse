import type { ChatMessage, TextBlock } from '../llm/types';
import type { Campaign, Character, EpisodicMemory, LoreEntry, LoreOverlay, Message, World } from '../storage/db';
import { modelTextOf } from '../data/repo';
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
  /** 推进时间是章节分隔：分隔点之前只保留这么多条衔接 */
  chapterTail?: number;
  l1Budget?: number;
  /** 扫描最近几条消息做 L1 触发 */
  scanDepth?: number;
  hasTools?: boolean;
  /** 有 share 工具（至少一个分享解析器） */
  hasShare?: boolean;
  /** 挂了服务端联网工具 */
  hasWeb?: boolean;
  /** 有 handle_attached 工具（有插件登记了依附的事） */
  hasAttach?: boolean;
  /** 自定义对话规则，空则用默认 */
  rules?: string;
  /** 剧情时间模式：不给真实时钟 */
  storyTime?: boolean;
}

export const DEFAULT_RULES = [
  '你在扮演一个角色，和用户在手机上聊天。这是纯线上的文字聊天，不是小说。',
  '始终以角色的身份、口吻和视角说话，不要跳出角色解释自己是 AI。',
  '只写角色打出来的字：不写动作、神态、环境描写，不用括号或星号加旁白。情绪靠语气、标点和表情符号。',
  '一次回复 1 到 4 条消息，每条一行，用换行分开，像连发几条微信。短的一句话就一条，不要编号，不要独白。',
  '长度和对方匹配，对方一句你就一两句。',
  '不要替用户说话或决定用户的行动。',
  '不要反复提同一个梗、同一件事，前面说过的话不要换个说法再说一遍。对方推进了时间，之前的话题就是过去的事，按新的时间点说话。',
  '用中文回复，除非角色设定要求其他语言。',
].join('\n');

const TOOL_RULES = [
  '你有一些工具可以查资料和记事：',
  '- 世界书目录列在下面。目录里有的条目，当对话确实需要细节时用 lore_read 读正文，不要每轮都查。',
  '- 想不起来以前发生过什么时用 memory_search 或 memory_recent。',
  '- 关系、情绪、地点或当前事实发生明确变化时，用 state_update 记下来。',
  '- 剧情让世界本身发生了变化（某个地方毁了、某条规则被打破）时，用 overlay_write 记下来，不要假装世界书没变。',
  '- /memories 是你的笔记本，用 memory 工具维护。只记长期有用的事：对方的偏好、约定、重要的身份信息、你们关系的里程碑。不要记聊天进度和流水账，对话记录本来就在。目录每轮都给你了，只在确实相关时才打开文件，不要每轮都翻。',
  '查完资料后正常回复，不要向用户复述你查了什么。',
].join('\n');
const SHARE_RULE = '- 想给对方分享一首歌、一部电影之类的东西时用 share 工具，它会查真实资料返回给你，并把卡片发给对方。引用歌词或台词只能引工具返回的原句，查不到就不引，不要编。';
const ATTACH_RULE = '- 最后一条消息里如果有「顺手处理的事」（比如对方评论了你的朋友圈），先用 handle_attached 按它给的 key 和结构提交，再回消息。像真人一样顺手就做了，不要在消息里复述。';
const WEB_RULE = '- 你可以上网（web_search 查、web_fetch 读网页）。只在确实需要外部信息时用：对方问起最近的事、要核实一个事实、或者分享的东西本地没查到。闲聊不要搜。';

function toolRules(input: AssembleInput): string {
  if (!input.hasTools) return '';
  const extra = [input.hasShare ? SHARE_RULE : '', input.hasAttach ? ATTACH_RULE : '', input.hasWeb ? WEB_RULE : ''].filter(Boolean);
  const lines = TOOL_RULES.split('\n');
  // 「查完资料后…」收尾句保持在最后
  return [...lines.slice(0, -1), ...extra, lines[lines.length - 1]!].join('\n');
}

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
  const { windowSize = 60, chapterTail = 6, scanDepth = 4, now = new Date() } = input;
  const isStyle = (e: LoreEntry) => e.kind === 'style';
  const loreOnly = input.lore.filter((e) => !isStyle(e));
  const constant = loreOnly.filter((e) => e.enabled && e.constant).sort((a, b) => a.order - b.order);
  const constantStyleAll = input.lore.filter((e) => isStyle(e) && e.enabled && e.constant).sort((a, b) => a.order - b.order);
  const constantStyle = constantStyleAll.filter((e) => e.position !== 'tail');
  const tailStyle = constantStyleAll.filter((e) => e.position === 'tail');

  const system = [
    section('规则', (input.rules?.trim() || DEFAULT_RULES) + (input.hasTools ? '\n\n' + toolRules(input) : '')),
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

  let recent = input.history.slice(-windowSize);
  // 章节分隔：最近一次推进时间之前的原话只留几条衔接，之前的事靠记忆，不靠复读
  const cut = recent.map((m, i) => (m.meta?.chapter ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  if (cut > chapterTail) recent = recent.slice(cut - chapterTail);
  const messages: ChatMessage[] = [];
  for (const m of recent) {
    if (m.role === 'system') continue;
    // 正文 + 卡片 alt：只有卡片的回复（发了红包、分享了歌）也要进历史
    const text = modelTextOf(m).trim();
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content.push({ type: 'text', text });
    else messages.push({ role: m.role, content: [{ type: 'text', text }] });
  }

  // L1：扫最近几条消息 + 本轮输入
  const scan = [...recent.slice(-scanDepth).map(modelTextOf), input.userText ?? ''].join('\n');
  const hits = triggerL1(input.lore, input.overlays.filter((o) => !o.pending), { scanText: scan, budgetTokens: input.l1Budget });

  const tail: string[] = [];
  const styleHits = hits.filter((h) => isStyle(h.entry));
  const loreHits = hits.filter((h) => !isStyle(h.entry));
  if (styleHits.length) tail.push('<风格>\n' + styleHits.map((h) => `## ${h.entry.title}\n${h.entry.content}`).join('\n\n') + '\n</风格>');
  if (loreHits.length) tail.push('<世界书>\n' + loreHits.map((h) => `## ${h.entry.title}${h.overlaid ? '（本局已变化）' : ''}\n${h.content}`).join('\n\n') + '\n</世界书>');
  tail.push(...(input.pluginVolatile ?? []).filter((t) => t.trim()));
  if (tailStyle.length) tail.push('<尾部指令>\n' + tailStyle.map((e) => e.content.trim()).filter(Boolean).join('\n\n') + '\n</尾部指令>');
  if (input.storyTime) tail.push(`（剧情时间模式：现在的剧情时间是「${input.campaign.state.inWorldTime || '未设定，由你根据对话决定'}」。时间推进时用 state_update 更新。）`);
  else tail.push(`现在是 ${now.toLocaleString('zh-CN', { hour12: false })}。`);
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

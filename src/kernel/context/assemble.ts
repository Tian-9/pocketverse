import type { ChatMessage, TextBlock } from '../llm/types';
import type { Campaign, Character, ConversationMode, EpisodicMemory, LoreEntry, LoreOverlay, Message, World } from '../storage/db';
import { modelTextOf } from '../data/repo';
import { triggerL1 } from './l1';
import { expandMacros } from './macros';
import { timeLine } from './time';
import { visibleHistory, isContext } from './append';
import { dayOf, memoryWhen, storyStartOf } from './days';

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
  /** 自动召回：按你刚说的话从情节记忆里翻出来的几条（memory/recall.ts），进最后一条消息 */
  recalled?: EpisodicMemory[];
  /** 状态事件折叠出来的硬事实行（memory/state.ts 的 stateLines），排在老的 facts 前面 */
  stateLines?: string[];
  history: Message[];
  /** 本轮用户输入；为空表示让角色接着说（重新生成） */
  userText?: string;
  /** 内核之外的段（插件的提示词片段、稍后联系、顺手处理的事），和内核自己的段一起按 place / order 排 */
  sections?: PromptSection[];
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
  /** 自定义对话规则，空则用默认（按 mode 选 DEFAULT_RULES / OFFLINE_RULES） */
  rules?: string;
  /** 线上（手机聊天，默认）还是线下（面对面推剧情）。决定默认规则，过滤只在一边生效的风格条目。见 ARCHITECTURE 6.1 */
  mode?: ConversationMode;
  /** 这局的钟和真实时间对不上（跳过了、或停表）：时间行标「剧情时间」 */
  story?: boolean;
}

export const DEFAULT_RULES = [
  '你在扮演一个角色，和{{user}}在手机上聊天。这是纯线上的文字聊天，不是小说。',
  '始终以角色的身份、口吻和视角说话，不要跳出角色解释自己是 AI。',
  '只写角色打出来的字：不写动作、神态、环境描写，不用括号或星号加旁白。情绪靠语气、标点和表情符号。',
  '一次回复 1 到 4 条消息，每条一行，用换行分开，像连发几条微信。短的一句话就一条，不要编号，不要独白。',
  '长度和对方匹配，对方一句你就一两句。',
  '不要替{{user}}说话或决定{{user}}的行动。',
  '不要反复提同一个梗、同一件事，前面说过的话不要换个说法再说一遍。对方推进了时间，之前的话题就是过去的事，按新的时间点说话。',
  '用中文回复，除非角色设定要求其他语言。',
].join('\n');

/** 线下（面对面推剧情）的默认规则：小说写法，一次推进一点。和线上的 DEFAULT_RULES 二选一，按会话模式来 */
export const OFFLINE_RULES = [
  '你在扮演一个角色，此刻和{{user}}面对面在一起。这是线下的场景，不是手机聊天：用小说的写法，写角色的动作、神态、说的话和周围的环境。',
  '始终以角色的身份和视角写，不要跳出角色解释自己是 AI。',
  '角色说的话放在「」里；动作、神态、环境用叙述。第三人称写角色，用「你」称呼{{user}}。',
  '一次回复一到三段、一两百字，推进一点就停，把回应的空间留给{{user}}。不要一口气演完一整场，不要替剧情下结论。',
  '{{user}}发来的可能是说的话，也可能是动作或旁白（括号、星号或直接叙述），都当作真的发生了，接着往下演。',
  '不要替{{user}}说话、决定{{user}}的行动或感受。',
  '不要反复提同一个梗、同一件事，前面写过的不要换个说法再写一遍。对方推进了时间或换了场景，之前的事就是过去的事。',
  '用中文回复，除非角色设定要求其他语言。',
].join('\n');

/** 这个模式的默认规则 */
export const defaultRules = (mode: ConversationMode = 'online') => (mode === 'offline' ? OFFLINE_RULES : DEFAULT_RULES);

/** 追加段（context/append.ts）的读法：完整快照，同一种以最后出现的为准 */
export const APPEND_RULE = '对话里夹着的尖括号段落（如 <钱包>、<商店>）是系统记下的当时的情况，对方看不到。每一段都是完整的，同一种以最后出现的那段为准，前面的已经过时。';

const TOOL_RULES = [
  '你有一些工具可以查资料和记事：',
  '- 世界书目录列在下面。目录里有的条目，当对话确实需要细节时用 lore_read 读正文，不要每轮都查。',
  '- 最后一条消息里的「可能相关的往事」是按对方这句话自动翻出来的，不一定都相关。还想不起来就用 memory_search 或 memory_recent。',
  '- 关系、情绪、地点或当前事实发生明确变化时，用 state_update 记下来。对话里明确过了一段时间（说了「明早见」然后对方接着说）就把 advance 一起填上，把时间往前拨。',
  '- 剧情让世界本身发生了变化（某个地方毁了、某条规则被打破）时，用 overlay_write 记下来，不要假装世界书没变。',
  '- /memories 是你的笔记本，用 memory 工具维护。只记长期有用的事：对方的偏好、约定、重要的身份信息、你们关系的里程碑。不要记聊天进度和流水账，对话记录本来就在。笔记正文每轮都在上面了，不用再 view；只在要记新东西或改东西时才用 memory 工具写。',
  '查完资料后正常回复，不要向{{user}}复述你查了什么。',
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

/**
 * 上下文里的一段。拼装器只做一件事：收集所有段，按 place 分两组，组内按 order 排，拼起来。
 *
 * - place 'cached'：进 system，排在历史前面，是缓存前缀。变一个字，后面整段历史的缓存都作废。
 * - place 'tail'：进最后一条用户消息、排在用户的话前面。每轮重算，不存进历史，下一轮自然消失，不碰缓存。
 *
 * 选位置看「变一次的代价」，不是多久变一次：又大、又几乎不变的才放 cached；会变的（不管多久一次）放 tail，
 * 每轮多付几百 token 也比变一次就重写整段历史便宜。order 是同一位置内的先后，小的在前，留空隙方便插。
 * 内核各段的 order 见 ORDER；插件不给就用 ORDER.pluginCached / ORDER.pluginTail。时间行固定最后（ORDER.time）。
 */
export interface PromptSection { id: string; place: 'cached' | 'tail'; order: number; text: string }

export const ORDER = {
  // cached（system）
  rules: 100, style: 150, user: 200, world: 300, character: 400, loreConstant: 500, loreDirectory: 600, pluginCached: 800,
  // tail（最后一条用户消息里，越靠后离用户的话越近，越受重视）
  state: 100, highlights: 150, styleHits: 200, loreHits: 300, recall: 400, pluginTail: 500, tailStyle: 800, time: 900,
} as const;

const cachedSec = (id: string, order: number, title: string, body: string | undefined): PromptSection | null =>
  body?.trim() ? { id, place: 'cached', order, text: `# ${title}\n${body.trim()}` } : null;
const tailSec = (id: string, order: number, tag: string, body: string | undefined): PromptSection | null =>
  body?.trim() ? { id, place: 'tail', order, text: `<${tag}>\n${body.trim()}\n</${tag}>` } : null;

export function loreDirectory(lore: LoreEntry[], overlays: LoreOverlay[]): string {
  const byId = new Map(overlays.filter((o) => o.loreEntryId && !o.pending).map((o) => [o.loreEntryId!, o]));
  const lines = lore.filter((e) => e.enabled).sort((a, b) => a.order - b.order).map((e) => {
    const ov = byId.get(e.id);
    return `- [${e.id}] ${e.title}：${ov ? `${ov.summary || e.summary}（本局已变化，原为：${e.summary}）` : e.summary}`;
  });
  for (const o of overlays) if (!o.loreEntryId && !o.pending) lines.push(`- [${o.id}] ${o.title}：${o.summary}（本局新增）`);
  return lines.join('\n');
}

function stateText(c: Campaign, chars: Character[], lines: string[] = []): string {
  const s = c.state;
  const name = (id: string) => chars.find((x) => x.id === id)?.name ?? id;
  const parts: string[] = [];
  if (s.location) parts.push(`地点：${s.location}`);
  for (const [id, v] of Object.entries(s.relations)) parts.push(`${name(id)} 与{{user}}的关系：${v}`);
  for (const [id, v] of Object.entries(s.mood)) parts.push(`${name(id)} 现在的情绪：${v}`);
  for (const [id, v] of Object.entries(s.nudge ?? {})) parts.push(`${name(id)} 的拍一拍后缀：${v}`);
  const facts = [...lines, ...s.facts];
  if (facts.length) parts.push('当前事实：\n' + facts.map((f) => `- ${f}`).join('\n'));
  return parts.join('\n');
}

/**
 * 拼装请求。顺序固定：规则 → 用户 → 世界 → 角色 → 状态 → 世界书目录 → 近期要事 → 笔记正文 → 插件稳定部分。
 * 缓存断点两处：system 末尾、倒数第二条消息末尾。易变内容只进最后一条用户消息，排在用户的话前面。
 */
export function assemble(input: AssembleInput): { system: TextBlock[]; messages: ChatMessage[]; l1Hits: string[]; /** L1 扫描用的文本 */ l1Scan: string; /** 窗口和章节截断之后剩下的历史（排查用） */ recent: Message[] } {
  const { windowSize = 60, chapterTail = 6, scanDepth = 4, now = new Date(), mode = 'online' } = input;
  const isStyle = (e: LoreEntry) => e.kind === 'style';
  const loreOnly = input.lore.filter((e) => !isStyle(e));
  // 风格条目可以只在线上或线下生效；标了另一边的在这条会话里当不存在
  input = { ...input, lore: input.lore.filter((e) => !isStyle(e) || !e.mode || e.mode === mode) };
  const constant = loreOnly.filter((e) => e.enabled && e.constant).sort((a, b) => a.order - b.order);
  const constantStyleAll = input.lore.filter((e) => isStyle(e) && e.enabled && e.constant).sort((a, b) => a.order - b.order);
  const constantStyle = constantStyleAll.filter((e) => e.position !== 'tail');
  const tailStyle = constantStyleAll.filter((e) => e.position === 'tail');

  // 章节分隔：最近一次推进时间之前的原话只留几条衔接，之前的事靠记忆，不靠复读
  const recent = visibleHistory(input.history, windowSize, chapterTail);
  const messages: ChatMessage[] = [];
  for (const m of recent) {
    // 追加段（context/append.ts）是 role system 的隐藏消息，模型当作用户侧内容看；其余 system 消息（出错提示等）不进
    if (m.role === 'system' && !isContext(m)) continue;
    const role = isContext(m) ? 'user' : m.role;
    // 正文 + 卡片 alt：只有卡片的回复（发了红包、分享了歌）也要进历史
    const text = modelTextOf(m).trim();
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push({ type: 'text', text });
    else messages.push({ role: role as 'user' | 'assistant', content: [{ type: 'text', text }] });
  }

  // L1：扫最近几条对话 + 本轮输入（追加段不算，钱包里的字不该触发世界书）
  const scan = [...recent.filter((m) => !isContext(m)).slice(-scanDepth).map(modelTextOf), input.userText ?? ''].join('\n');
  const hits = triggerL1(input.lore, input.overlays.filter((o) => !o.pending), { scanText: scan, budgetTokens: input.l1Budget });
  const styleHits = hits.filter((h) => isStyle(h.entry));
  const loreHits = hits.filter((h) => !isStyle(h.entry));
  // 记忆的时间统一成「Day 36（11/14 周五 晚上，4 天前）」：第几天、哪天、隔了多久都由代码算好
  const start = storyStartOf(input.campaign), tz = input.characters[0]?.timeZone;
  const memLine = (m: EpisodicMemory) => { const w = memoryWhen(m, start, now.getTime(), tz); return `- ${w ? w + '：' : ''}${m.text}`; };

  // 所有段，内核的和外面给的放在一起排
  const sections = [
    // ---- cached：又大又几乎不变 ----
    cachedSec('rules', ORDER.rules, '规则', (input.rules?.trim() || defaultRules(mode)) + '\n' + APPEND_RULE + (input.hasTools ? '\n\n' + toolRules(input) : '')),
    cachedSec('style', ORDER.style, '写作风格与附加指令', constantStyle.map((e) => `## ${e.title}\n${e.content}`).join('\n\n')),
    // 名字只在这里写死一次，其余一律 {{user}}，最后统一换成这一局的名字
    cachedSec('user', ORDER.user, '对方', `和你聊天的人叫「{{user}}」。${input.campaign.userPersona?.trim() ? '\n在这个世界里，{{user}}是：' + input.campaign.userPersona.trim() : ''}${input.userProfile ? '\n' + input.userProfile : ''}`),
    cachedSec('world', ORDER.world, `世界：${input.world.name}`, input.world.summary),
    ...input.characters.map((c) => cachedSec(`character:${c.id}`, ORDER.character, input.characters.length > 1 ? `角色：${c.name}` : `你扮演的角色：${c.name}`, c.core)),
    cachedSec('loreConstant', ORDER.loreConstant, '世界书（常驻）', constant.map((e) => `## ${e.title}\n${e.content}`).join('\n\n')),
    cachedSec('loreDirectory', ORDER.loreDirectory, '世界书目录', loreDirectory(loreOnly.filter((e) => !e.constant), input.overlays)),
    // 笔记不在这里：放 system 他一写笔记整段历史缓存作废，走追加段（变了才写进历史，见 chat 引擎）
    // ---- tail：会变的 ----
    // 状态几轮一变（聊天里 state_update、整理），放 system 的话一变整段历史缓存作废
    tailSec('state', ORDER.state, '当前状态', stateText(input.campaign, input.characters, input.stateLines)),
    tailSec('highlights', ORDER.highlights, '近期要事', input.highlights.map(memLine).join('\n')),
    tailSec('styleHits', ORDER.styleHits, '风格', styleHits.map((h) => `## ${h.entry.title}\n${h.entry.content}`).join('\n\n')),
    tailSec('loreHits', ORDER.loreHits, '世界书', loreHits.map((h) => `## ${h.entry.title}${h.overlaid ? '（本局已变化）' : ''}\n${h.content}`).join('\n\n')),
    tailSec('recall', ORDER.recall, '可能相关的往事', (input.recalled ?? []).map(memLine).join('\n')),
    tailSec('tailStyle', ORDER.tailStyle, '尾部指令', tailStyle.map((e) => e.content.trim()).filter(Boolean).join('\n\n')),
    { id: 'time', place: 'tail', order: ORDER.time, text: `${timeLine(now, tz, undefined, input.story)}\n今天是这局的 Day ${dayOf(now.getTime(), start, tz)}。` } as PromptSection,
    ...(input.sections ?? []).filter((x) => x.text.trim()),
  ].filter((x): x is PromptSection => !!x);
  // 同一 order 保持登记顺序（Array.prototype.sort 是稳定的）
  const ordered = (place: PromptSection['place']) => sections.filter((x) => x.place === place).sort((a, b) => a.order - b.order);
  const system: TextBlock[] = ordered('cached').map((x) => ({ type: 'text', text: x.text }));
  system[system.length - 1]!.cache = true;
  const tail = ordered('tail').map((x) => x.text);

  // 尾巴排在用户这轮的话前面：聊天引擎先把用户的消息存进历史再拼，所以它已经是最后一条用户消息；
  // 他最后读到的几百字要是对方刚说的话，不是日记和时间行
  const pre: TextBlock = { type: 'text', text: tail.join('\n\n') };
  const userText = input.userText?.trim();
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    last.content.unshift(pre);
    if (userText) last.content.push({ type: 'text', text: userText });
  } else {
    messages.push({ role: 'user', content: [{ type: 'text', text: [pre.text, userText].filter(Boolean).join('\n\n') }] });
  }

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
  return { system, messages, l1Hits: loreHits.map((h) => h.entry.title), l1Scan: scan, recent };
}

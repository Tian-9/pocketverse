/**
 * 排日程：一次便宜模型调用，按角色设定和世界给未来几天排安排（和商店「进货」同一个办法）。
 * 这里只做纯函数（拼提示词、定 schema、解析结果），不碰库，方便测。
 */

export interface PlanMaterial {
  characterName: string;
  core: string;
  worldName: string;
  worldSummary: string;
  /** 条目目录，可以为空 */
  loreDirectory: string;
  location?: string;
  mood?: string;
  /** 这一局当前事实 + 近期要事 */
  happenings: string[];
  /** 要排的日子，YYYY-MM-DD（周几由调用方附在后面，如「2026-10-12 周一」） */
  days: string[];
  /** 这些日子里已经有的安排（标题），别重复、别冲突 */
  existing: string[];
}

export interface PlanItem { date: string; start: string; end?: string; title: string; place?: string }

export const PLAN_SYSTEM = `你在给一个角色的日历记几件「特别的事」，像他手机日历里会记的那种，不是作息表。
要求：
- 固定的作息一律不写：上班、上课、早读、自习、晚自习、补习、开会、通勤、吃饭、锻炼这些他天天都在过，自己知道，写进来反而把日子塞满了。
- 工作日（周一到周五）：大多数一条都不写。只在那天真有特别的事时写一条：生日、节日、考试、体检看病、和人约好的事、一次性的出门办事。
- 周末和节假日（节假日按这个世界的常识判断，当周末对待）：最多一两件，留出大段空白给他自己过，可以一件都不写。
- 整个几天加起来，宁少勿多。一条都不写也完全可以，返回空的 items。
- 用「HH:MM」写时间，大多数给 end；标题短，像日历里的一行（「阿姨生日」「去书店」），不要句子；place 可选，写地名。
- 已经有的安排不要重复，也不要和它们撞时间。
- 不要出现「用户」「角色」「AI」这些词，不要解释。
- 严格按给定的 JSON 结构输出。`;

const list = (xs: string[], empty: string) => (xs.length ? xs.map((x) => '- ' + x).join('\n') : empty);

export function planUser(m: PlanMaterial): string {
  const parts = [`# 他是谁\n${m.characterName}：${m.core.slice(0, 800)}`, `# 这个世界\n${m.worldName}${m.worldSummary ? '：' + m.worldSummary : ''}`];
  if (m.loreDirectory) parts.push(`# 设定目录（地点、机构可以从这里取材）\n${m.loreDirectory}`);
  parts.push(`# 现在\n${m.location ? '地点：' + m.location + '\n' : ''}${m.mood ? '情绪：' + m.mood + '\n' : ''}最近发生的事（可以影响这几天在忙什么）：\n${list(m.happenings, '（没什么大事）')}`);
  parts.push(`# 要排的日子\n${m.days.map((d) => '- ' + d).join('\n')}`);
  if (m.existing.length) parts.push(`# 这几天已经有的安排，别重复、别撞时间\n${list(m.existing, '')}`);
  return parts.join('\n\n');
}

export function planSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'start', 'end', 'title', 'place'], properties: {
      date: { type: 'string', description: 'YYYY-MM-DD，只能是要排的日子之一' }, start: { type: 'string', description: 'HH:MM' },
      end: { type: 'string', description: 'HH:MM，没有就空字符串' }, title: { type: 'string', description: '短标题' }, place: { type: 'string', description: '地点，可空' },
    } } } },
  };
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** 周六、周日（日期键按日历日算，和时区无关） */
export function isWeekend(date: string): boolean {
  const d = new Date(date.slice(0, 10) + 'T00:00').getDay();
  return d === 0 || d === 6;
}
/** 每天最多几条：工作日只留一件特别的事，周末一两件，别排满 */
export const MAX_PER_DAY = { weekday: 1, weekend: 2 } as const;
/** 固定作息：工作日一律不进日历（提示词已经说了，这里兜底）。带这些字但明显是特别的事（生日、考试、约好的）不算 */
const ROUTINE = /上课|早读|晚自习|自习|上班|晨会|例会|开会|补习|辅导|答疑|午饭|午餐|早饭|早餐|晚饭|晚餐|吃饭|食堂|通勤|晨练|早操|跑操|放学|值日|午休|写作业|作业/;
const SPECIAL = /生日|节|考|约|聚|婚|医|病|体检|演出|比赛|旅行|出发|搬家|面试/;
export const isRoutine = (title: string) => ROUTINE.test(title) && !SPECIAL.test(title);

/** 模型给的安排按规矩收一收：工作日去掉固定作息、每天封顶。顺序按日期、时间 */
export function shapePlan(items: PlanItem[]): PlanItem[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.start.padStart(5, '0').localeCompare(b.start.padStart(5, '0')));
  const count = new Map<string, number>();
  return sorted.filter((it) => {
    const weekend = isWeekend(it.date);
    if (!weekend && isRoutine(it.title)) return false;
    const n = count.get(it.date) ?? 0;
    if (n >= (weekend ? MAX_PER_DAY.weekend : MAX_PER_DAY.weekday)) return false;
    count.set(it.date, n + 1);
    return true;
  });
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 解析模型输出：日期不在要排的日子里、时间格式不对、没标题的都丢掉；解析不出来返回空数组 */
export function parsePlan(text: string, days: string[]): PlanItem[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const items = (raw as { items?: unknown })?.items;
  const allowed = new Set(days.map((d) => d.slice(0, 10)));
  return (Array.isArray(items) ? items : []).map((x) => {
    const o = x as { date?: unknown; start?: unknown; end?: unknown; title?: unknown; place?: unknown };
    const end = str(o?.end, 5), place = str(o?.place, 40);
    return { date: str(o?.date, 10), start: str(o?.start, 5), ...(TIME.test(end) ? { end } : {}), title: str(o?.title, 40), ...(place ? { place } : {}) };
  }).filter((p) => allowed.has(p.date) && TIME.test(p.start) && p.title);
}

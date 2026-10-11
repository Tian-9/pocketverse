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

export const PLAN_SYSTEM = `你在给一个角色排接下来几天的日程，像他自己的日历 App 里会有的那种。
要求：
- 贴角色设定和这个世界：上班的有上班，上学的有课，修仙的有早课和打坐，周末和平日不一样。固定的作息每天都有，但别每天一模一样；穿插一两件只有那天才有的小事（约人、出门、买东西、看医生）。
- 每天 2 到 4 条，用「HH:MM」写时间，大多数给 end；标题短，像日历里的一行（「晨会」「去图书馆还书」），不要句子；place 可选，写地名。
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

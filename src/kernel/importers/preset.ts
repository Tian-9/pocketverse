import type { LoreEntry } from '../storage/db';

/**
 * 预设（风格包）导入。支持两种：
 * - SillyTavern 聊天补全预设：prompts[] + prompt_order。只取文字段落，采样参数不要。
 *   injection_position=1（插在对话里）的段落放尾部，其余放 system。marker 段（聊天记录、世界书占位）跳过。
 * - 本应用导出的风格包：{ pocketverse: 'preset', name, entries }。
 */
export interface PresetEntry {
  title: string;
  content: string;
  position: 'system' | 'tail';
  /** 原文件里是否启用 */
  include: boolean;
  /** 来源标识，如 ST 的 identifier */
  source?: string;
}
export interface ParsedPreset { name: string; entries: PresetEntry[] }

interface StPrompt { identifier?: string; name?: string; content?: string; marker?: boolean; enabled?: boolean; injection_position?: number; injection_depth?: number; system_prompt?: boolean; role?: string }
interface StPreset { prompts?: StPrompt[]; prompt_order?: { character_id?: number; order?: { identifier: string; enabled?: boolean }[] }[]; name?: string }

const ST_TITLES: Record<string, string> = { main: '主提示', nsfw: 'NSFW 段', jailbreak: '破限段', enhanceDefinitions: '强化设定', personaDescription: '用户描述', charDescription: '角色描述', charPersonality: '角色性格', scenario: '场景', worldInfoBefore: '世界书（前）', worldInfoAfter: '世界书（后）', dialogueExamples: '示例对话', chatHistory: '聊天记录' };

export function parsePreset(json: unknown, fileName = ''): ParsedPreset {
  if (!json || typeof json !== 'object') throw new Error('不是 JSON 对象');
  const j = json as Record<string, unknown>;
  const baseName = fileName.replace(/\.json$/i, '').trim();
  if (j.pocketverse === 'preset' && Array.isArray(j.entries)) {
    const entries = (j.entries as Partial<PresetEntry>[]).filter((e) => typeof e.content === 'string' && e.content.trim()).map((e, i) => ({
      title: String(e.title ?? `段落 ${i + 1}`).slice(0, 80), content: String(e.content), position: e.position === 'tail' ? 'tail' as const : 'system' as const, include: e.include !== false,
    }));
    return { name: String(j.name ?? baseName ?? '风格包').slice(0, 60), entries };
  }
  const st = j as StPreset;
  if (!Array.isArray(st.prompts)) throw new Error('不认识的格式：既不是酒馆聊天补全预设，也不是本应用的风格包');
  const byId = new Map<string, StPrompt>();
  for (const p of st.prompts) if (p && typeof p === 'object' && p.identifier) byId.set(p.identifier, p);
  // 顺序和启用状态以 prompt_order 为准（默认角色 100001，没有就取第一组）；没有 prompt_order 就按 prompts 原顺序
  const orders = Array.isArray(st.prompt_order) ? st.prompt_order : [];
  const order = (orders.find((o) => o.character_id === 100001) ?? orders[0])?.order;
  const seq: { p: StPrompt; enabled: boolean }[] = order
    ? order.filter((o) => byId.has(o.identifier)).map((o) => ({ p: byId.get(o.identifier)!, enabled: o.enabled !== false }))
    : st.prompts.filter((p) => p && typeof p === 'object').map((p) => ({ p, enabled: p.enabled !== false }));
  const entries: PresetEntry[] = [];
  for (const { p, enabled } of seq) {
    if (p.marker) continue;
    const content = String(p.content ?? '').trim();
    if (!content) continue;
    const id = p.identifier ?? '';
    entries.push({
      title: (p.name?.trim() || ST_TITLES[id] || id || `段落 ${entries.length + 1}`).slice(0, 80),
      content, position: p.injection_position === 1 ? 'tail' : 'system', include: enabled, source: id || undefined,
    });
  }
  return { name: (st.name ?? baseName ?? '酒馆预设').toString().slice(0, 60), entries };
}

/** 导出成本应用的风格包格式 */
export function exportPreset(name: string, entries: LoreEntry[]): string {
  return JSON.stringify({
    pocketverse: 'preset', name,
    entries: entries.map((e) => ({ title: e.title, content: e.content, position: e.position === 'tail' ? 'tail' : 'system', include: e.enabled })),
  }, null, 2);
}

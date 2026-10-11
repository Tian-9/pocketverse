/**
 * 模型档位：请求按用途分三档，每档一个模型、一个思考深度。
 * 分档的依据是缓存形态：对话档 system 稳定、历史长，吃缓存；整理和批量都是一次性输入。
 * 模型升级只改这里的默认表。
 */
export type ModelRole = 'chat' | 'consolidate' | 'bulk';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RoleInfo { id: ModelRole; label: string; note: string }

export const ROLES: RoleInfo[] = [
  { id: 'chat', label: '对话', note: '聊天、补发动态和日记、角色画画。system 稳定、历史长，吃缓存，贵模型命中缓存可能比便宜模型没命中还便宜' },
  { id: 'consolidate', label: '整理', note: '把聊天合并成记忆和状态。一次性输入，结果只进库，便宜的就行' },
  { id: 'bulk', label: '批量', note: '论坛路人、商品货架、搜索、日程。一次性、输出多、结构化，质量差直接看得见' },
];

export const DEFAULT_MODELS: Record<ModelRole, string> = {
  chat: 'claude-opus-5-5',
  consolidate: 'claude-haiku-5-5',
  bulk: 'claude-haiku-5-5',
};

export const DEFAULT_EFFORTS: Record<ModelRole, Effort> = { chat: 'medium', consolidate: 'low', bulk: 'low' };

export const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'low', label: '低' }, { id: 'medium', label: '中' }, { id: 'high', label: '高' }, { id: 'xhigh', label: '很高' }, { id: 'max', label: '最高' },
];

export const effortLabel = (e: Effort) => EFFORTS.find((x) => x.id === e)?.label ?? e;

/**
 * 思考占的 max_tokens。API 把 thinking 和正文算在同一个 max_tokens 里，调用方给的 maxTokens 只是正文预算
 * （日记 600、动态 200），思考深度一调高，思考就把正文的额度吃光，正文写到一半 stop_reason 变 max_tokens。
 * 网关按 effort 在调用方的预算上加这一截；这只是上限，不是花费。
 */
export const THINKING_ROOM: Record<Effort, number> = { low: 1024, medium: 2048, high: 4096, xhigh: 8192, max: 16384 };
export const thinkingRoom = (e: Effort | undefined) => THINKING_ROOM[e ?? 'medium'];

/** 没显式给档位的请求按用途归档：只有记忆整理是整理档，其余（聊天、补发、插件）都是对话档；插件 `cheap` 在注册表里映射成批量档。 */
export function roleOf(purpose: string, role?: ModelRole): ModelRole {
  if (role) return role;
  return purpose === 'consolidate' ? 'consolidate' : 'chat';
}

export interface RoleSettings { models: Record<ModelRole, string>; efforts: Record<ModelRole, Effort> }

/** 把存的设置补全成三档；老设置只有一个 `model` / `effort`，它们是对话档的。 */
export function normalizeRoles(raw: { models?: Partial<Record<ModelRole, string>>; efforts?: Partial<Record<ModelRole, Effort>>; model?: string; effort?: Effort }): RoleSettings {
  const models = { ...DEFAULT_MODELS, ...(raw.models ?? {}) };
  const efforts = { ...DEFAULT_EFFORTS, ...(raw.efforts ?? {}) };
  if (!raw.models?.chat && raw.model) models.chat = raw.model;
  if (!raw.efforts?.chat && raw.effort) efforts.chat = raw.effort;
  return { models, efforts };
}

/** 从 API 拉到的模型（没有价格），或内置兜底表里的一项。 */
export interface ModelInfo { id: string; label: string; createdAt?: string }

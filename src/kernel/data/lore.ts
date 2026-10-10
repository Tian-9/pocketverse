import type { LoreEntry } from '../storage/db';

/**
 * 一局里要用的设定：所在世界的条目 + 在场角色的人物背景（跟卡走，不看世界）+ 全局风格指令。
 * 拼上下文和记忆整理都用这一条规则，别各写一份。
 */
export function loreApplies(e: LoreEntry, worldId: string, characterIds: string[]): boolean {
  if (e.kind === 'style') return true;
  if (e.characterIds?.length) return e.characterIds.some((id) => characterIds.includes(id));
  return e.worldId === worldId;
}

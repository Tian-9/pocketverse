import type { PluginContext } from '$kernel/api';
import type { Character } from '$kernel/storage/db';
import { ulid } from 'ulid';

/**
 * 角色卡的历史版本：改卡前自动留一份，每张卡最多 KEEP 份，能恢复。
 * 只管卡上的文字（名字、设定、开场白、时间设置），不碰头像、记忆、存档。
 */
export type VersionData = Pick<Character, 'name' | 'core' | 'full' | 'firstMessage' | 'useFirstMessage' | 'timeZone'>;
export interface CharacterVersion { id: string; characterId: string; createdAt: number; label: string; data: VersionData }

export const KEEP = 30;

let ctx: PluginContext;
export function setVersionsContext(c: PluginContext) { ctx = c; }
export const versionsTable = () => ctx.table<CharacterVersion>('versions');

export function snapshotOf(c: Character): VersionData {
  const d: VersionData = { name: c.name, core: c.core, full: c.full };
  if (c.firstMessage) d.firstMessage = c.firstMessage;
  if (c.useFirstMessage) d.useFirstMessage = true;
  if (c.timeZone) d.timeZone = c.timeZone;
  return d;
}

export function sameData(a: VersionData, b: VersionData): boolean {
  return a.name === b.name && a.core === b.core && a.full === b.full && (a.firstMessage ?? '') === (b.firstMessage ?? '')
    && !!a.useFirstMessage === !!b.useFirstMessage && (a.timeZone ?? '') === (b.timeZone ?? '');
}

/** 留一份；和最新一份一样就不留。返回有没有真的留 */
export async function backup(c: Character, label: string): Promise<boolean> {
  const data = snapshotOf(c);
  const mine = await versionsTable().where('characterId').equals(c.id).sortBy('createdAt');
  const latest = mine[mine.length - 1];
  if (latest && sameData(latest.data, data)) return false;
  // 同一毫秒连留两份时顺序也要定：createdAt 严格递增
  const createdAt = Math.max(Date.now(), (latest?.createdAt ?? 0) + 1);
  await versionsTable().add({ id: ulid(), characterId: c.id, createdAt, label, data });
  const extra = mine.length + 1 - KEEP;
  if (extra > 0) await versionsTable().bulkDelete(mine.slice(0, extra).map((v) => v.id));
  return true;
}

export async function deleteVersionsOf(characterId: string) {
  await versionsTable().where('characterId').equals(characterId).delete();
}

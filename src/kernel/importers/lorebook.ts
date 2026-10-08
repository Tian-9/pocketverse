import type { LoreEntry } from '../storage/db';

/** SillyTavern 世界书 JSON：{ entries: { [n]: {...} } } 或 { entries: [...] }，也兼容角色卡内嵌的 character_book。 */
export function parseLorebook(json: unknown, kind: 'lore' | 'style' = 'lore'): Omit<LoreEntry, 'id' | 'worldId'>[] {
  const root = json as Record<string, unknown>;
  const raw = root?.entries ?? (root?.data as Record<string, unknown> | undefined)?.entries;
  const list: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw as object) : [];
  if (!list.length) throw new Error('不是世界书：没有 entries');
  return list.map((e, i) => {
    const keys = ([] as unknown[]).concat(e.key ?? e.keys ?? []).filter((k): k is string => typeof k === 'string' && k.trim() !== '');
    const content = typeof e.content === 'string' ? e.content : '';
    const title = (typeof e.comment === 'string' && e.comment.trim()) || (typeof e.name === 'string' && e.name.trim()) || keys[0] || `条目 ${i + 1}`;
    return {
      title,
      summary: content.replace(/\s+/g, ' ').slice(0, 60),
      content,
      scope: 'world' as const,
      kind,
      triggers: { keywords: keys, recursive: e.excludeRecursion === true ? false : undefined },
      constant: e.constant === true,
      order: typeof e.order === 'number' ? e.order : typeof e.insertion_order === 'number' ? e.insertion_order : i,
      enabled: !(e.disable === true || e.enabled === false),
    };
  });
}

import type { LoreEntry, LoreOverlay } from '../storage/db';
import { estimateTokens } from './tokens';

export interface L1Options { scanText: string; budgetTokens?: number; maxDepth?: number }

function hit(entry: LoreEntry, text: string): boolean {
  const lower = text.toLowerCase();
  if (entry.triggers.keywords.some((k) => k && lower.includes(k.toLowerCase()))) return true;
  if (entry.triggers.regex) {
    try { return new RegExp(entry.triggers.regex, 'iu').test(text); } catch { return false; }
  }
  return false;
}

/**
 * L1 触发：扫最近消息文本，命中关键词或正则的条目插入。
 * recursive 条目的正文会再做一轮匹配（最多 maxDepth 层）。按 order 排序后按预算截断。
 * 覆盖优先：有 overlay 的条目用 overlay 的 content。
 */
export function triggerL1(entries: LoreEntry[], overlays: LoreOverlay[], opts: L1Options): { entry: LoreEntry; content: string; overlaid: boolean }[] {
  const { budgetTokens = 4000, maxDepth = 2 } = opts;
  const byId = new Map(overlays.filter((o) => o.loreEntryId).map((o) => [o.loreEntryId!, o]));
  const enabled = entries.filter((e) => e.enabled && !e.constant);
  const picked = new Map<string, LoreEntry>();
  let texts = [opts.scanText];
  for (let depth = 0; depth <= maxDepth && texts.length; depth++) {
    const next: string[] = [];
    for (const e of enabled) {
      if (picked.has(e.id)) continue;
      if (texts.some((t) => hit(e, t))) {
        picked.set(e.id, e);
        if (e.triggers.recursive) next.push(byId.get(e.id)?.content ?? e.content);
      }
    }
    texts = next;
  }
  const sorted = [...picked.values()].sort((a, b) => a.order - b.order);
  const out: { entry: LoreEntry; content: string; overlaid: boolean }[] = [];
  let used = 0;
  for (const e of sorted) {
    const ov = byId.get(e.id);
    const content = ov ? ov.content : e.content;
    const cost = estimateTokens(content);
    if (used + cost > budgetTokens) continue;
    used += cost;
    out.push({ entry: e, content, overlaid: !!ov });
  }
  return out;
}

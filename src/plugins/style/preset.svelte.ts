import type { ParsedPreset, PresetEntry } from '$kernel/importers/preset';
import { scanText, type Finding } from '$kernel/importers/scan';

export type DraftEntry = PresetEntry & { key: number };

/** 预设导入前检查的草稿：检查页和段落页共用。 */
class PresetDraft {
  active = $state(false);
  name = $state('');
  entries = $state<DraftEntry[]>([]);
  findings = $derived.by<(Finding & { key: number })[]>(() =>
    this.entries.flatMap((e) => (e.include ? scanText(String(e.key), e.content).map((f) => ({ ...f, key: e.key })) : [])));

  start(p: ParsedPreset) {
    this.name = p.name;
    this.entries = p.entries.map((e, i) => ({ ...e, key: i }));
    this.active = true;
  }
  reset() { this.active = false; this.name = ''; this.entries = []; }
}
export const presetDraft = new PresetDraft();

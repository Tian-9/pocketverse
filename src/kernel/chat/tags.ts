export interface ParsedTag { tag: string; attrs: Record<string, string>; body: string }

/** 从模型回复里抽出 <tag attr="v">body</tag> 形式的插件标签，返回剩余文本和标签列表。 */
export function extractTags(text: string, tags: string[]): { text: string; found: ParsedTag[] } {
  if (!tags.length) return { text, found: [] };
  const found: ParsedTag[] = [];
  const names = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`<(${names})((?:\\s+[\\w-]+="[^"]*")*)\\s*>([\\s\\S]*?)<\\/\\1>`, 'g');
  const rest = text.replace(re, (_m, tag: string, attrStr: string, body: string) => {
    const attrs: Record<string, string> = {};
    for (const m of attrStr.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]!] = m[2]!;
    found.push({ tag, attrs, body: body.trim() });
    return '';
  });
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), found };
}

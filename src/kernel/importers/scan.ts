/**
 * 本地风险扫描：只在本机跑正则，不调任何接口。
 * 目的是把可能触发安全策略的片段标出来让用户自己删，不替用户决定。
 */
export interface Finding { field: string; kind: '破限' | '可疑内容' | '未成年' | '非自愿' | '极端暴力'; snippet: string; index: number; length: number }

const RULES: { kind: Finding['kind']; re: RegExp }[] = [
  { kind: '破限', re: /ignore (all |any )?(previous|prior|above) (instructions|rules)|无视(所有|一切|之前的)?(限制|规则|指令|约束)|忽略(所有|一切|之前的)?(限制|规则|指令|约束)|不受.{0,8}(限制|约束)|jailbreak|破限|越狱|developer mode|开发者模式|没有任何(限制|道德|审查)|无(道德|审查|过滤)/i },
  { kind: '可疑内容', re: /\bNSFW\b|R-?18|18\+|成人内容|色情|性爱|做爱|性交|淫荡|淫乱|淫秽|淫靡|意淫|淫水|淫叫|高潮|阴茎|阴道|乳头|射精|自慰|口交|肛交|explicit sexual|sexual content|erotic|\bsex\b/i },
  { kind: '未成年', re: /\bloli\b|\bshota\b|萝莉|正太|幼女|幼童|未成年|小学生|初中生|minor|underage|\b1[0-7]\s*(岁|years? old)|\b[1-9]\s*岁/i },
  { kind: '非自愿', re: /强奸|迷奸|轮奸|非自愿|强迫.{0,4}(发生|进行)|rape|non-?consensual|drugged/i },
  { kind: '极端暴力', re: /分尸|虐杀|酷刑|gore|torture porn|snuff/i },
];

export function scanText(field: string, text: string): Finding[] {
  const out: Finding[] = [];
  if (!text) return out;
  for (const r of RULES) {
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g');
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(text)) && n++ < 5) {
      const i = m.index;
      out.push({ field, kind: r.kind, index: i, length: m[0].length, snippet: text.slice(Math.max(0, i - 20), Math.min(text.length, i + m[0].length + 20)).replace(/\s+/g, ' ') });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

export function scanFields(fields: Record<string, string>): Finding[] {
  return Object.entries(fields).flatMap(([k, v]) => scanText(k, v));
}

/** 脱敏：所有字符串替换成 [N 字]，保留结构，给开发者看格式用。 */
export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return `[${[...value].length} 字]`;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)]));
  return value;
}

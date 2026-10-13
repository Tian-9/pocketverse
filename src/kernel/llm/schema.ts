/**
 * 结构化输出（output_config.format）只认 JSON Schema 的一个子集：数值约束（minimum / maximum / multipleOf）、
 * 字符串长度（minLength / maxLength）、数组约束（maxItems、大于 1 的 minItems、uniqueItems）都会 400，
 * 对象必须 additionalProperties: false。官方 SDK 只在 parse() 辅助里自动处理，我们走原始流式接口，得自己来。
 *
 * 这里把不支持的约束剥掉，改写进 description（模型照样看得到「最多 3 个」），对象补上 additionalProperties: false。
 * 约束本身由调用方的代码兜底（parseBag / parsePatches / slice / clamp），不指望模型。
 */
const NUMERIC = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const;
const STRING = ['minLength', 'maxLength'] as const;
const ARRAY = ['maxItems', 'uniqueItems', 'minContains', 'maxContains'] as const;

type Schema = Record<string, unknown>;

function hint(s: Schema): string[] {
  const out: string[] = [];
  if (typeof s.minimum === 'number' && typeof s.maximum === 'number') out.push(`取值 ${s.minimum} 到 ${s.maximum}`);
  else if (typeof s.minimum === 'number') out.push(`至少 ${s.minimum}`);
  else if (typeof s.maximum === 'number') out.push(`至多 ${s.maximum}`);
  if (typeof s.multipleOf === 'number') out.push(`${s.multipleOf} 的倍数`);
  if (typeof s.maxLength === 'number') out.push(`不超过 ${s.maxLength} 字`);
  if (typeof s.minLength === 'number' && s.minLength > 0) out.push(`至少 ${s.minLength} 字`);
  if (typeof s.maxItems === 'number') out.push(`最多 ${s.maxItems} 项`);
  if (typeof s.minItems === 'number' && s.minItems > 1) out.push(`至少 ${s.minItems} 项`);
  if (s.uniqueItems === true) out.push('不要重复');
  return out;
}

export function sanitizeSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((x) => sanitizeSchema(x)) as T;
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Schema;
  const out: Schema = {};
  for (const [k, v] of Object.entries(s)) {
    if ((NUMERIC as readonly string[]).includes(k) || (STRING as readonly string[]).includes(k) || (ARRAY as readonly string[]).includes(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    // 这些键下面是「名字 → 子 schema」或子 schema 列表，递归；其余原样（enum、const、required 里的字符串不能碰）
    if (k === 'properties' || k === '$defs' || k === 'definitions') {
      out[k] = Object.fromEntries(Object.entries(v as Schema).map(([n, sub]) => [n, sanitizeSchema(sub)]));
    } else if (k === 'items' || k === 'anyOf' || k === 'allOf' || k === 'oneOf' || k === 'not' || k === 'prefixItems') {
      out[k] = sanitizeSchema(v);
    } else out[k] = v;
  }
  const h = hint(s);
  if (h.length) out.description = [typeof s.description === 'string' ? s.description : '', `（${h.join('，')}）`].filter(Boolean).join('');
  const isObject = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object')) || 'properties' in s;
  if (isObject) out.additionalProperties = false;
  return out as T;
}

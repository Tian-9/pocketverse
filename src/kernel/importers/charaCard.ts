/**
 * 角色卡导入：SillyTavern / TavernAI 的 PNG（tEXt chunk "chara" 或 "ccv3"）和纯 JSON（V1/V2/V3）。
 */
export interface ParsedCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  systemPrompt: string;
  creatorNotes: string;
  tags: string[];
  /** V2/V3 内嵌的世界书原始对象，M4 接 ST 世界书导入时用 */
  characterBook?: unknown;
}

export function parseCardJson(json: unknown): ParsedCard {
  const root = json as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
  const s = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : '');
  const name = s('name') || s('char_name');
  if (!name) throw new Error('不是角色卡：缺少 name 字段');
  return {
    name,
    description: s('description') || s('char_persona'),
    personality: s('personality'),
    scenario: s('scenario') || s('world_scenario'),
    firstMessage: s('first_mes') || s('char_greeting'),
    exampleDialogue: s('mes_example') || s('example_dialogue'),
    systemPrompt: s('system_prompt'),
    creatorNotes: s('creator_notes'),
    tags: Array.isArray(data.tags) ? (data.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    characterBook: data.character_book,
  };
}

/** 从 PNG 字节里取出 tEXt 块中的角色卡 JSON。优先 ccv3，其次 chara。 */
export function extractCardFromPng(bytes: Uint8Array): unknown {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('不是 PNG 文件');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  const found: Record<string, string> = {};
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const dataStart = pos + 8;
    if (type === 'tEXt') {
      const chunk = bytes.subarray(dataStart, dataStart + len);
      const nul = chunk.indexOf(0);
      if (nul > 0) {
        const key = latin1(chunk.subarray(0, nul));
        if (key === 'chara' || key === 'ccv3') found[key] = latin1(chunk.subarray(nul + 1));
      }
    }
    if (type === 'IEND') break;
    pos = dataStart + len + 4;
  }
  const b64 = found.ccv3 ?? found.chara;
  if (!b64) throw new Error('这张 PNG 里没有角色卡数据');
  return JSON.parse(utf8Decode(base64ToBytes(b64)));
}

export async function parseCardFile(file: File): Promise<ParsedCard> {
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    return parseCardJson(extractCardFromPng(new Uint8Array(await file.arrayBuffer())));
  }
  return parseCardJson(JSON.parse(await file.text()));
}

/** 把卡拆成 core（进 L0）和 full（L2 可拉取）。M2 会加模型压缩。 */
export function cardToCharacterFields(card: ParsedCard) {
  const core = [card.description, card.personality && `性格：${card.personality}`, card.scenario && `场景：${card.scenario}`].filter(Boolean).join('\n\n');
  const full = [core, card.exampleDialogue && `示例对话：\n${card.exampleDialogue}`, card.systemPrompt && `作者的系统提示：\n${card.systemPrompt}`].filter(Boolean).join('\n\n');
  return { name: card.name, core, full, firstMessage: card.firstMessage || undefined };
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8Decode(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b);
}

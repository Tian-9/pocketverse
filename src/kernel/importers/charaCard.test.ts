import { describe, it, expect } from 'vitest';
import { parseCardJson, extractCardFromPng, cardToCharacterFields } from './charaCard';

// 最小 PNG 编码器：签名 + IHDR + tEXt + IEND，CRC 必须正确
function crc32(buf: Uint8Array): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function pngWithText(key: string, value: string): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
  const kv = new Uint8Array([...Array.from(key, (c) => c.charCodeAt(0)), 0, ...Array.from(value, (c) => c.charCodeAt(0))]);
  const text = chunk('tEXt', kv);
  const iend = chunk('IEND', new Uint8Array());
  const all = new Uint8Array(sig.length + ihdr.length + text.length + iend.length);
  all.set(sig, 0); all.set(ihdr, sig.length); all.set(text, sig.length + ihdr.length); all.set(iend, sig.length + ihdr.length + text.length);
  return all;
}

const v2 = { spec: 'chara_card_v2', data: { name: '林晚秋', description: '图书馆管理员', personality: '安静', scenario: '雨夜', first_mes: '你来了。', mes_example: '<START>…', tags: ['现代'] } };

describe('charaCard', () => {
  it('parses V2 json and V1 flat json', () => {
    expect(parseCardJson(v2).name).toBe('林晚秋');
    expect(parseCardJson({ name: 'A', char_persona: 'p', char_greeting: 'hi' })).toMatchObject({ name: 'A', description: 'p', firstMessage: 'hi' });
    expect(() => parseCardJson({})).toThrow();
  });

  it('extracts base64 json from a PNG tEXt chara chunk (utf-8 inside)', () => {
    const b64 = Buffer.from(JSON.stringify(v2), 'utf8').toString('base64');
    const card = parseCardJson(extractCardFromPng(pngWithText('chara', b64)));
    expect(card.name).toBe('林晚秋');
    expect(card.tags).toEqual(['现代']);
  });

  it('rejects non-png and png without card', () => {
    expect(() => extractCardFromPng(new Uint8Array([1, 2, 3]))).toThrow('不是 PNG');
    expect(() => extractCardFromPng(pngWithText('Comment', 'x'))).toThrow('没有角色卡');
  });

  it('splits into core and full', () => {
    const f = cardToCharacterFields(parseCardJson(v2));
    expect(f.core).toContain('图书馆管理员');
    expect(f.core).not.toContain('示例对话');
    expect(f.full).toContain('示例对话');
    expect(f.firstMessage).toBe('你来了。');
  });
});

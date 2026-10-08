/** 粗略 token 估算：CJK 每字约 1 token，其他每 4 字符约 1 token。够做预算，不做计费。 */
export function estimateTokens(text: string): number {
  let cjk = 0, other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x2ffff)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

/**
 * SillyTavern 聊天记录（.jsonl）：首行是元数据 {user_name, character_name, chat_metadata}，
 * 之后每行一条消息 {name, is_user, mes, send_date, extra?}。send_date 可能是字符串或毫秒数。
 */
export interface StMessage { role: 'user' | 'assistant'; text: string; ts: number; name: string }
export interface StChat { userName?: string; characterName?: string; summary?: string; authorsNote?: string; messages: StMessage[] }

export function parseStChat(text: string): StChat {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('文件是空的');
  const out: StChat = { messages: [] };
  let base = Date.now() - lines.length * 60_000;
  for (const [i, line] of lines.entries()) {
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { throw new Error(`第 ${i + 1} 行不是合法 JSON`); }
    if (i === 0 && !('mes' in obj) && ('user_name' in obj || 'character_name' in obj || 'chat_metadata' in obj)) {
      out.userName = typeof obj.user_name === 'string' ? obj.user_name : undefined;
      out.characterName = typeof obj.character_name === 'string' ? obj.character_name : undefined;
      const meta = (obj.chat_metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.summary === 'string') out.summary = meta.summary;
      if (typeof meta.note_prompt === 'string') out.authorsNote = meta.note_prompt;
      continue;
    }
    if (typeof obj.mes !== 'string') continue;
    const sd = obj.send_date;
    let ts = typeof sd === 'number' ? sd : typeof sd === 'string' ? Date.parse(sd) : NaN;
    if (!Number.isFinite(ts)) ts = base + i * 60_000;
    base = Math.max(base, ts - i * 60_000);
    out.messages.push({ role: obj.is_user === true ? 'user' : 'assistant', text: obj.mes.trim(), ts, name: typeof obj.name === 'string' ? obj.name : '' });
  }
  if (!out.messages.length) throw new Error('没有找到消息，确认是 SillyTavern 导出的 .jsonl');
  // 保证时间单调递增，导入后顺序才对
  for (let i = 1; i < out.messages.length; i++) if (out.messages[i]!.ts <= out.messages[i - 1]!.ts) out.messages[i]!.ts = out.messages[i - 1]!.ts + 1;
  return out;
}

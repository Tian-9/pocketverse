import { db } from '../storage/db';

/**
 * Claude memory 工具（memory_20250818）的后端：每个存档一棵 /memories 树，存在 memfs 表。
 * 命令语义照 Anthropic 文档：view / create / str_replace / insert / delete / rename。
 */
export interface MemCommand {
  command: 'view' | 'create' | 'str_replace' | 'insert' | 'delete' | 'rename';
  path: string; file_text?: string; old_str?: string; new_str?: string;
  insert_line?: number; insert_text?: string; old_path?: string; new_path?: string; view_range?: [number, number];
}

const ROOT = '/memories';

function norm(p: string): string {
  if (/(^|\/)\.\.?(\/|$)/.test(p)) throw new Error('路径不能包含 . 或 ..');
  const clean = ('/' + p).replace(/\/+/g, '/');
  if (clean !== ROOT && !clean.startsWith(ROOT + '/')) throw new Error(`路径必须在 ${ROOT} 下`);
  return clean.replace(/\/$/, '') || ROOT;
}

export async function runMemoryCommand(campaignId: string, cmd: MemCommand): Promise<string> {
  const t = db().memfs;
  const path = norm(cmd.command === 'rename' ? cmd.old_path ?? cmd.path : cmd.path);
  const get = () => t.where('[campaignId+path]').equals([campaignId, path]).first();
  switch (cmd.command) {
    case 'view': {
      const file = await get();
      if (file) {
        const lines = file.content.split('\n');
        const [a, b] = cmd.view_range ?? [1, lines.length];
        return lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join('\n');
      }
      const all = await t.where('campaignId').equals(campaignId).toArray();
      const under = all.filter((f) => f.path.startsWith(path + '/') || path === ROOT);
      if (!under.length && path !== ROOT) throw new Error(`不存在：${path}`);
      return `目录 ${path}：\n` + (under.map((f) => f.path).sort().join('\n') || '（空）');
    }
    case 'create': {
      await t.put({ campaignId, path, content: cmd.file_text ?? '', updatedAt: Date.now() });
      return `已写入 ${path}`;
    }
    case 'str_replace': {
      const file = await get();
      if (!file) throw new Error(`不存在：${path}`);
      const n = file.content.split(cmd.old_str ?? '').length - 1;
      if (n !== 1) throw new Error(n === 0 ? 'old_str 没找到' : 'old_str 出现多次，请给更长的片段');
      await t.put({ ...file, content: file.content.replace(cmd.old_str!, cmd.new_str ?? ''), updatedAt: Date.now() });
      return `已替换 ${path}`;
    }
    case 'insert': {
      const file = await get();
      if (!file) throw new Error(`不存在：${path}`);
      const lines = file.content.split('\n');
      lines.splice(Math.max(0, Math.min(cmd.insert_line ?? lines.length, lines.length)), 0, cmd.insert_text ?? '');
      await t.put({ ...file, content: lines.join('\n'), updatedAt: Date.now() });
      return `已插入 ${path}`;
    }
    case 'delete': {
      const all = await t.where('campaignId').equals(campaignId).toArray();
      const victims = all.filter((f) => f.path === path || f.path.startsWith(path + '/'));
      if (!victims.length) throw new Error(`不存在：${path}`);
      await t.bulkDelete(victims.map((f) => [campaignId, f.path] as [string, string]));
      return `已删除 ${path}`;
    }
    case 'rename': {
      const to = norm(cmd.new_path ?? '');
      const file = await get();
      if (!file) throw new Error(`不存在：${path}`);
      await t.delete([campaignId, path]);
      await t.put({ ...file, path: to, updatedAt: Date.now() });
      return `已改名为 ${to}`;
    }
  }
}

/** 给 L0 用：列出记忆目录里的文件名和首行，让模型知道有什么可以看。 */
export async function memoryIndex(campaignId: string): Promise<string> {
  const files = await db().memfs.where('campaignId').equals(campaignId).toArray();
  if (!files.length) return '';
  return files.sort((a, b) => a.path.localeCompare(b.path)).map((f) => `- ${f.path}：${f.content.split('\n')[0]?.slice(0, 60) ?? ''}`).join('\n');
}

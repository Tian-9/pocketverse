import { describe, it, expect, beforeAll } from 'vitest';
import { openDB } from '../storage/db';
import { runMemoryCommand, memoryNotes } from './memfs';

beforeAll(() => { openDB([]); });

describe('memfs', () => {
  it('supports the full command set scoped to a campaign', async () => {
    const c = 'camp1';
    await runMemoryCommand(c, { command: 'create', path: '/memories/user.md', file_text: '# 用户\n喜欢雨天' });
    expect(await runMemoryCommand(c, { command: 'view', path: '/memories/user.md' })).toBe('1: # 用户\n2: 喜欢雨天');
    await runMemoryCommand(c, { command: 'str_replace', path: '/memories/user.md', old_str: '雨天', new_str: '雪天' });
    await runMemoryCommand(c, { command: 'insert', path: '/memories/user.md', insert_line: 1, insert_text: '名字：阿天' });
    expect(await runMemoryCommand(c, { command: 'view', path: '/memories/user.md' })).toContain('2: 名字：阿天');
    expect(await runMemoryCommand(c, { command: 'view', path: '/memories' })).toContain('/memories/user.md');
    expect(await memoryNotes(c)).toBe('## /memories/user.md\n# 用户\n名字：阿天\n喜欢雪天');
    expect(await memoryNotes('other')).toBe('');
    await runMemoryCommand(c, { command: 'rename', path: '/memories/user.md', old_path: '/memories/user.md', new_path: '/memories/u.md' });
    await expect(runMemoryCommand(c, { command: 'view', path: '/memories/user.md' })).rejects.toThrow();
    await runMemoryCommand(c, { command: 'delete', path: '/memories/u.md' });
    expect(await memoryNotes(c)).toBe('');
  });
  it('truncates long notes per file and lists the rest once the total budget is spent', async () => {
    const c = 'cp-big';
    await runMemoryCommand(c, { command: 'create', path: '/memories/a.md', file_text: 'a'.repeat(50) });
    await runMemoryCommand(c, { command: 'create', path: '/memories/b.md', file_text: 'b'.repeat(50) });
    await runMemoryCommand(c, { command: 'create', path: '/memories/c.md', file_text: 'c'.repeat(10) });
    const notes = await memoryNotes(c, { perFile: 30, total: 50 });
    expect(notes).toContain('## /memories/a.md\n' + 'a'.repeat(30) + '\n……（还有 20 字');
    expect(notes).toContain('## /memories/b.md\n' + 'b'.repeat(20) + '\n……（还有 30 字');
    expect(notes).toContain('## /memories/c.md\n（10 字，没放下');
  });
  it('rejects paths outside /memories', async () => {
    await expect(runMemoryCommand('c', { command: 'create', path: '/etc/passwd', file_text: '' })).rejects.toThrow();
    await expect(runMemoryCommand('c', { command: 'create', path: '/memories/../x', file_text: '' })).rejects.toThrow();
  });
});

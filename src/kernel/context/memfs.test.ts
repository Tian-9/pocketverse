import { describe, it, expect, beforeAll } from 'vitest';
import { openDB } from '../storage/db';
import { runMemoryCommand, memoryIndex } from './memfs';

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
    expect(await memoryIndex(c)).toContain('user.md');
    expect(await memoryIndex('other')).toBe('');
    await runMemoryCommand(c, { command: 'rename', path: '/memories/user.md', old_path: '/memories/user.md', new_path: '/memories/u.md' });
    await expect(runMemoryCommand(c, { command: 'view', path: '/memories/user.md' })).rejects.toThrow();
    await runMemoryCommand(c, { command: 'delete', path: '/memories/u.md' });
    expect(await memoryIndex(c)).toBe('');
  });
  it('rejects paths outside /memories', async () => {
    await expect(runMemoryCommand('c', { command: 'create', path: '/etc/passwd', file_text: '' })).rejects.toThrow();
    await expect(runMemoryCommand('c', { command: 'create', path: '/memories/../x', file_text: '' })).rejects.toThrow();
  });
});

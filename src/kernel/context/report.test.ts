import { describe, it, expect } from 'vitest';
import { assemble, type AssembleInput } from './assemble';
import { buildReport, classifyLore, type ReportInput } from './report';
import type { Campaign, Character, LoreEntry, World } from '../storage/db';

const world: World = { id: 'w', name: '雨城', summary: '总在下雨', createdAt: 0, updatedAt: 0 };
const ch: Character = { id: 'c', name: '林晚秋', core: '雨城的邮差', full: '很长的完整设定' };
const cp: Campaign = { id: 'cp', worldId: 'w', characterIds: ['c'], name: '第一局', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } };
const L = (p: Partial<LoreEntry> & { id: string; title: string }): LoreEntry => ({ worldId: 'w', summary: 's', content: 'c', scope: 'world', triggers: { keywords: [] }, constant: false, order: 0, enabled: true, ...p });

const lore = [
  L({ id: 'const', title: '常驻', constant: true }),
  L({ id: 'kw', title: '邮局', triggers: { keywords: ['邮局'] } }),
  L({ id: 'miss', title: '钟楼', triggers: { keywords: ['钟楼'] } }),
  L({ id: 'none', title: '无钥匙', summary: '' }),
  L({ id: 'off', title: '关掉的', enabled: false }),
  L({ id: 'big', title: '太长', content: '字'.repeat(20000), triggers: { keywords: ['邮局'] }, order: 9 }),
  L({ id: 'tail', title: '尾部', kind: 'style', constant: true, position: 'tail', worldId: 'global' }),
];
const other = L({ id: 'x', title: '别的世界', worldId: 'w2' });

function make(useTools = true): ReportInput {
  const input: AssembleInput = {
    world, campaign: cp, characters: [ch], userName: '我', lore, overlays: [], highlights: [], history: [
      { id: 'm1', conversationId: 'v', role: 'user', content: [{ type: 'text', text: '去邮局吗' }], ts: 1 },
    ], stateLines: ['猫 · 位置：客栈B'], hasTools: useTools,
  };
  return {
    character: ch, campaign: cp, world, worlds: [world, { ...world, id: 'w2', name: '修仙' }], allLore: [...lore, other], overlays: [],
    memories: [], memfs: [], stateEvents: [], input, assembled: assemble(input),
    toolNames: useTools ? ['lore_read', 'character_read', 'memory_search'] : [], useTools, contributions: [], request: 'REQ',
    settings: { model: 'm', effort: 'medium', tools: useTools, web: false, preview: false },
  };
}

describe('context report', () => {
  it('says where each applicable entry went and why', () => {
    const rows = new Map(classifyLore(make()).map((r) => [r.entry.id, r]));
    expect(rows.get('const')!.placement).toBe('system');
    expect(rows.get('kw')!.placement).toBe('tail');
    expect(rows.get('miss')!.placement).toBe('directory');
    expect(rows.get('miss')!.notes.join()).toContain('lore_read');
    expect(rows.get('none')!.notes.join()).toContain('永远不会自动进');
    expect(rows.get('none')!.notes.join()).toContain('摘要是空的');
    expect(rows.get('off')!.placement).toBe('none');
    expect(rows.get('big')!.notes.join()).toContain('预算');
    expect(rows.get('tail')!.placement).toBe('tail');
    expect(rows.has('x')).toBe(false);
  });

  it('renders a markdown report with the request, the card, out-of-scope lore and raw settings', () => {
    const md = buildReport(make());
    expect(md).toContain('# 林晚秋 · 上下文排查');
    expect(md).toContain('模型要调 character_read');
    expect(md).toContain('世界「修仙」的 1 条');
    expect(md).toContain('REQ');
    expect(md).toContain('"core": "雨城的邮差"');
  });

  it('flags what the model cannot see when tools are off', () => {
    const md = buildReport(make(false));
    expect(md).toContain('**关**');
    expect(md).toContain('**看不到**：工具关了');
    expect(classifyLore(make(false)).find((r) => r.entry.id === 'miss')!.notes.join()).toContain('读不到全文');
  });
});

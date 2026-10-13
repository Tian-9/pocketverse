import { describe, it, expect } from 'vitest';
import { assemble, type AssembleInput } from './assemble';
import type { Campaign, Character, Message, World } from '../storage/db';

/**
 * 缓存的硬约束：上一轮请求里缓存断点之前的内容，下一轮必须一字不差地出现在同样的位置。
 * 尾巴（召回、插件易变段、时间行）只在当轮最后一条用户消息里，不存进历史，下一轮自然消失，所以不该破坏这条。
 */
const world: World = { id: 'w', name: '椿城', summary: '', createdAt: 0, updatedAt: 0 };
const ch: Character = { id: 'c', name: '方亦楷', core: '同桌', full: '' };
const cp: Campaign = { id: 'cp', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } };
const msg = (id: string, role: Message['role'], text: string): Message => ({ id, conversationId: 'v', role, content: [{ type: 'text', text }], ts: Number(id.slice(1)) });

function serialize(r: ReturnType<typeof assemble>) {
  // 按 API 的渲染顺序展开成块，记下每个断点的位置
  const blocks: { text: string; cache?: boolean }[] = [
    ...r.system.map((b) => ({ text: 'S:' + b.text, cache: b.cache })),
    ...r.messages.flatMap((m) => m.content.map((b) => ({ text: m.role + ':' + (b.type === 'text' ? b.text : ''), cache: b.type === 'text' ? b.cache : false }))),
  ];
  return blocks;
}

describe('cache prefix stability across turns', () => {
  it('everything up to the previous turn’s last breakpoint is unchanged in the next turn', () => {
    const base: AssembleInput = { world, campaign: cp, characters: [ch], userName: '李梦', lore: [], overlays: [], highlights: [], history: [] };
    const h1 = [msg('m1', 'user', '早'), msg('m2', 'assistant', '马上到'), msg('m3', 'user', '终于快下课了')];
    const turn1 = assemble({ ...base, history: h1, sections: [{ id: 'p', place: 'tail', order: 500, text: '<钱包>余额 1872</钱包>' }], recalled: [{ id: 'r', campaignId: 'cp', when: '昨晚', text: '他要煎饼果子', importance: 2, sourceMessageIds: [], createdAt: 0 }], now: new Date(1) });
    const h2 = [...h1, msg('m4', 'assistant', '还有十二分钟'), msg('m5', 'user', '走走走')];
    // 两轮之间状态和近期要事都变了（聊天里 state_update、整理出新的三星）：它们在尾巴里，不该碰缓存前缀
    const turn2 = assemble({ ...base, stateLines: ['债务 · 欠款：他 欠 {{user}} 49.5 元'], highlights: [{ id: 'h', campaignId: 'cp', when: '', text: '新的大事', importance: 3, sourceMessageIds: [], createdAt: 0 }], history: h2, sections: [{ id: 'p', place: 'tail', order: 500, text: '<钱包>余额 1850</钱包>' }], now: new Date(2) });

    const b1 = serialize(turn1), b2 = serialize(turn2);
    const lastBp = b1.map((b, i) => (b.cache ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastBp).toBeGreaterThan(0);
    // 第一轮断点之前（含断点那块）的每一块，第二轮同位置一模一样
    expect(b2.slice(0, lastBp + 1).map((b) => b.text)).toEqual(b1.slice(0, lastBp + 1).map((b) => b.text));
    // 第一轮的尾巴不会留在第二轮的历史里
    const t2 = b2.map((b) => b.text).join('\n');
    expect(t2).not.toContain('余额 1872');
    expect(t2).not.toContain('他要煎饼果子');
    // 第二轮的尾巴只在最后一条用户消息里，且排在你说的话前面
    const lastUser = turn2.messages.at(-1)!.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(lastUser.indexOf('余额 1850')).toBeLessThan(lastUser.indexOf('走走走'));
  });
});

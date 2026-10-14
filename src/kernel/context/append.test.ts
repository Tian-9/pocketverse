import { describe, it, expect } from 'vitest';
import { appendTs, contextMessage, pendingAppends, visibleHistory } from './append';
import { assemble } from './assemble';
import type { Campaign, Character, Message, World } from '../storage/db';

const msg = (id: string, role: Message['role'], text: string, ts: number, meta?: Record<string, unknown>): Message => ({ id, conversationId: 'v', role, content: [{ type: 'text', text }], ts, ...(meta ? { meta } : {}) });
const wallet = (n: number) => `<钱包>\n你的余额：¥${n}.00\n</钱包>`;
const snap = (id: string, text: string, ts: number) => contextMessage('v', { id: 'redpacket/packets', text }, ts, ts, id);

describe('append sections', () => {
  it('writes a snapshot only when it changed or fell out of the window', () => {
    const items = [{ id: 'redpacket/packets', text: wallet(1872) }, { id: 'shop/things', text: '' }];
    // 没有过：写；空的不写
    expect(pendingAppends([], items).map((x) => x.id)).toEqual(['redpacket/packets']);
    // 一样：不写
    const h = [msg('u1', 'user', '早', 1), snap('c1', wallet(1872), 1.5), msg('a1', 'assistant', '早啊', 2)];
    expect(pendingAppends(h, items)).toEqual([]);
    // 变了：写
    expect(pendingAppends(h, [{ id: 'redpacket/packets', text: wallet(1850) }]).length).toBe(1);
    // 推进时间把它截出窗口了：补一份
    const cut = [...h, ...Array.from({ length: 8 }, (_, i) => msg(`x${i}`, i % 2 ? 'assistant' : 'user', '…', 3 + i)), msg('ch', 'user', '（时间来到…）', 20, { chapter: true }), msg('u9', 'user', '在吗', 21)];
    expect(visibleHistory(cut).some((m) => m.id === 'c1')).toBe(false);
    expect(pendingAppends(visibleHistory(cut), items).length).toBe(1);
  });

  it('a new snapshot sits right before your message, never after it', () => {
    const h = [msg('a1', 'assistant', '早啊', 100), msg('u1', 'user', '在干嘛', 200)];
    expect(appendTs(h, 0, 999)).toBe(199.5);
    expect(appendTs(h, 1, 999)).toBeCloseTo(199.51);
    expect(appendTs([msg('a1', 'assistant', '早啊', 100)], 0, 999)).toBe(999);
  });

  it('the model sees snapshots as user-side text in order; you never do; they never trigger lore', () => {
    const world: World = { id: 'w', name: '椿城', summary: '', createdAt: 0, updatedAt: 0 };
    const ch: Character = { id: 'c', name: '方亦楷', core: '同桌', full: '' };
    const cp: Campaign = { id: 'cp', worldId: 'w', characterIds: ['c'], name: 'x', createdAt: 0, lastPlayedAt: 0, state: { relations: {}, mood: {}, facts: [] } };
    const lore = [{ id: 'l', worldId: 'w', title: '钱包店', summary: 's', content: '一家店', scope: 'world' as const, triggers: { keywords: ['余额'] }, constant: false, order: 0, enabled: true }];
    const history = [msg('u0', 'user', '早', 1), msg('a0', 'assistant', '早啊', 2), snap('c1', wallet(1872), 2.5), msg('u1', 'user', '中午吃什么', 3)];
    const r = assemble({ world, campaign: cp, characters: [ch], userName: '李梦', lore, overlays: [], highlights: [], history });
    const last = r.messages.at(-1)!;
    expect(last.role).toBe('user');
    const texts = last.content.map((b) => (b.type === 'text' ? b.text : ''));
    // 尾巴、快照、你的话：你的话压轴
    expect(texts.at(-2)).toBe(wallet(1872));
    expect(texts.at(-1)).toBe('中午吃什么');
    expect(r.l1Hits).toEqual([]);
    expect(r.system[0]!.text).toContain('同一种以最后出现的那段为准');
  });
});

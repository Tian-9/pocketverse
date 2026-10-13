import { describe, it, expect } from 'vitest';
import { toUserMacro, fromUserMacro } from './userref';

describe('user macro', () => {
  it('stores the name and 用户 as {{user}}, shows them as this campaign’s name', () => {
    const stored = toUserMacro('方亦楷答应周末带用户看小猫，Hana 说要带猫粮', 'Hana');
    expect(stored).toBe('方亦楷答应周末带{{user}}看小猫，{{user}} 说要带猫粮');
    expect(fromUserMacro(stored, '小花', '方亦楷')).toBe('方亦楷答应周末带小花看小猫，小花 说要带猫粮');
  });
  it('never replaces a one-character name like the default 我', () => {
    expect(toUserMacro('我欠用户一顿饭', '我')).toBe('我欠{{user}}一顿饭');
  });
});

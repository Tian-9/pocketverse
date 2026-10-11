import { describe, it, expect } from 'vitest';
import { crowdUser, crowdSchema, parseCrowd } from './crowd';

describe('forum crowd', () => {
  it('prompt carries world, happenings, existing titles and waiting threads with the nickname', () => {
    const u = crowdUser({
      worldName: '王都', worldSummary: '中世纪', loreDirectory: '- [a] 王宫：很大', time: '春分', location: '东市',
      happenings: ['城门塌了'], recentTitles: ['今天的面包涨价了'], newPosts: 3, nickname: '路过的猫',
      waiting: [{ n: 1, title: '有人见过黑猫吗', body: '昨晚在巷子里', replies: [{ name: '老王', body: '没有' }] }],
    });
    for (const s of ['王都：中世纪', '王宫：很大', '春分', '东市', '城门塌了', '今天的面包涨价了', '写 3 个新帖', '路过的猫', '有人见过黑猫吗', '老王「没有」']) expect(u).toContain(s);
  });

  it('prompt leaves out sections that have nothing', () => {
    const u = crowdUser({ worldName: 'w', worldSummary: '', loreDirectory: '', time: 't', happenings: [], recentTitles: [], newPosts: 0, waiting: [], nickname: 'x' });
    expect(u).not.toContain('# 新帖');
    expect(u).not.toContain('# 等人接话');
    expect(u).not.toContain('# 设定目录');
    expect(u).toContain('（没什么大事）');
  });

  it('schema only requires the parts that were asked for', () => {
    expect((crowdSchema(true, false) as { required: string[] }).required).toEqual(['posts']);
    expect((crowdSchema(false, true) as { required: string[] }).required).toEqual(['replies']);
    expect((crowdSchema(true, true) as { required: string[] }).required).toEqual(['posts', 'replies']);
    // 便宜模型会照抄「别重复」列表里的标题：title 字段本身要说清
    const title = (crowdSchema(true, false) as { properties: { posts: { items: { properties: { title: { description: string } } } } } }).properties.posts.items.properties.title;
    expect(title.description).toContain('已经有了');
  });

  it('parse drops broken items, trims lengths, and survives garbage', () => {
    const out = parseCrowd(JSON.stringify({
      posts: [
        { name: ' 老王 ', title: '标题', body: '正文', tag: '闲聊', replies: [{ name: 'a', body: 'b' }, { name: '', body: 'x' }] },
        { name: '没正文', title: 't', body: '' },
        'junk',
      ],
      replies: [{ n: 1, items: [{ name: 'c', body: 'd' }] }, { n: 'x', items: [] }, { n: 2, items: [] }],
    }));
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]).toEqual({ name: '老王', title: '标题', body: '正文', tag: '闲聊', replies: [{ name: 'a', body: 'b' }] });
    expect(out.replies).toEqual([{ n: 1, items: [{ name: 'c', body: 'd' }] }]);
    expect(parseCrowd('not json')).toEqual({ posts: [], replies: [] });
    expect(parseCrowd(JSON.stringify({ posts: [{ name: 'n', title: 'x'.repeat(100), body: 'y', replies: [] }] })).posts[0]!.title).toHaveLength(60);
  });
});

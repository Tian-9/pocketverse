import { describe, it, expect } from 'vitest';
import { lookupSong, verifyQuote, norm } from './lookup';

const LYRICS = '故事的小黄花\n从出生那年就飘着\n童年的荡秋千\n随记忆一直晃到现在';
const itunes = { results: [
  { trackName: '晴天 (Live)', artistName: '别人', artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://p/live.m4a', trackViewUrl: 'https://music.apple.com/live', trackTimeMillis: 200000 },
  { trackName: '晴天', artistName: '周杰伦', collectionName: '叶惠美', artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://p/a.m4a', trackViewUrl: 'https://music.apple.com/a', trackTimeMillis: 269000 },
] };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const fetchOk = ((url: string) => {
  if (url.startsWith('https://itunes.apple.com/')) return json(itunes);
  if (url.startsWith('https://lrclib.net/api/get')) return json({ trackName: '晴天', artistName: '周杰伦', plainLyrics: LYRICS });
  return json([], 404);
}) as unknown as typeof fetch;

describe('music lookup', () => {
  it('normalizes for comparison', () => {
    expect(norm(' 故事的小黄花，')).toBe('故事的小黄花');
  });

  it('verifies quotes against the original lines, spanning two lines at most', () => {
    expect(verifyQuote('故事的小黄花', LYRICS)).toBe('故事的小黄花');
    expect(verifyQuote('小黄花，从出生那年就飘着', LYRICS)).toBe('故事的小黄花 / 从出生那年就飘着');
    expect(verifyQuote('刮风这天我试过握着你手', LYRICS)).toBeNull();
    expect(verifyQuote('花', LYRICS)).toBeNull();
  });

  it('builds a card with cover, preview, links and a verified quote', async () => {
    const r = await lookupSong({ type: 'music', title: '晴天', subtitle: '周杰伦', quote: '童年的荡秋千' }, fetchOk);
    expect(r.card).toMatchObject({ type: 'music', title: '晴天', subtitle: '周杰伦', preview: 'https://p/a.m4a', quote: '童年的荡秋千', source: 'itunes+lrclib' });
    expect(r.card.cover).toBe('https://x/600x600bb.jpg');
    expect(r.card.links?.map((l) => l.label)).toEqual(['Apple Music', '网易云搜索']);
    expect(r.forModel).toContain(LYRICS);
    expect(r.forModel).toContain('已放在卡片上');
  });

  it('drops an unverifiable quote and says so', async () => {
    const r = await lookupSong({ type: 'music', title: '晴天', subtitle: '周杰伦', quote: '编的歌词' }, fetchOk);
    expect(r.card.quote).toBeUndefined();
    expect(r.forModel).toContain('在歌词里没有');
  });

  it('falls back to lrclib search when exact lookup misses', async () => {
    const f = ((url: string) => {
      if (url.startsWith('https://itunes.apple.com/')) return json({ results: [] });
      if (url.startsWith('https://lrclib.net/api/get')) return json({}, 404);
      if (url.startsWith('https://lrclib.net/api/search')) return json([{ trackName: '别的歌', plainLyrics: 'x' }, { trackName: '晴天', artistName: '周杰伦', plainLyrics: LYRICS }]);
      return json({}, 500);
    }) as unknown as typeof fetch;
    const r = await lookupSong({ type: 'music', title: '晴天', subtitle: '周杰伦' }, f);
    expect(r.card.source).toBe('lrclib');
    expect(r.card.cover).toBeUndefined();
    expect(r.forModel).toContain('没查到这首歌的资料');
    expect(r.forModel).toContain(LYRICS);
  });

  it('degrades to a bare card and tells the model not to invent when everything fails', async () => {
    const f = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const r = await lookupSong({ type: 'music', title: '晴天', subtitle: '周杰伦', quote: '随便' }, f);
    expect(r.card).toMatchObject({ type: 'music', title: '晴天', subtitle: '周杰伦', source: 'none' });
    expect(r.card.quote).toBeUndefined();
    expect(r.card.links).toHaveLength(1);
    expect(r.forModel).toContain('不要引用歌词，也不要编');
    expect(r.forModel).toContain('web_search');
  });
});

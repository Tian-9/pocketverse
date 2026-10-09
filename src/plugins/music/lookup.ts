import type { ShareCard, ShareQuery, ShareResult } from '$kernel/api';

/**
 * 歌曲查找：iTunes Search 拿封面 / 试听 / 链接，LRCLIB 拿歌词。
 * 两个都免费、无 Key、允许跨域，在浏览器里直接请求，不经过模型。
 * 任何一步失败都降级，不抛给模型；查不到歌词就明确告诉模型不要编。
 */
export interface SongMeta { title: string; artist: string; album?: string; cover?: string; preview?: string; url?: string; durationSec?: number }
type Fetch = typeof fetch;

const TIMEOUT = 8000;
const withTimeout = (f: Fetch) => (url: string) => f(url, { signal: AbortSignal.timeout(TIMEOUT) });

/** 比对用：去空白和标点，小写 */
export const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const similar = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

interface ItunesTrack { trackName?: string; artistName?: string; collectionName?: string; artworkUrl100?: string; previewUrl?: string; trackViewUrl?: string; trackTimeMillis?: number }

export async function searchItunes(title: string, artist: string | undefined, f: Fetch = fetch): Promise<SongMeta | null> {
  const get = withTimeout(f);
  const term = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  const pick = (list: ItunesTrack[]) => {
    const byTitle = list.filter((t) => t.trackName && similar(t.trackName, title));
    const byBoth = artist ? byTitle.filter((t) => t.artistName && similar(t.artistName, artist)) : [];
    return byBoth[0] ?? byTitle[0] ?? null;
  };
  for (const country of ['CN', '']) {
    try {
      const res = await get(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=8${country ? '&country=' + country : ''}`);
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: ItunesTrack[] };
      const t = pick(data.results ?? []);
      if (!t) continue;
      return {
        title: t.trackName!, artist: t.artistName ?? artist ?? '', album: t.collectionName,
        cover: t.artworkUrl100?.replace(/100x100bb/, '600x600bb'), preview: t.previewUrl, url: t.trackViewUrl,
        durationSec: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : undefined,
      };
    } catch { /* 下一个 */ }
  }
  return null;
}

interface LrcRecord { trackName?: string; artistName?: string; plainLyrics?: string | null; instrumental?: boolean }

export async function fetchLyrics(title: string, artist: string | undefined, durationSec?: number, f: Fetch = fetch): Promise<string | null> {
  const get = withTimeout(f);
  const q = (o: Record<string, string | number | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  // 精确接口要歌名 + 歌手；有时长更准
  if (artist) {
    try {
      const res = await get(`https://lrclib.net/api/get?${q({ track_name: title, artist_name: artist, duration: durationSec })}`);
      if (res.ok) { const r = (await res.json()) as LrcRecord; if (r.plainLyrics?.trim()) return r.plainLyrics.trim(); }
    } catch { /* 走搜索 */ }
  }
  try {
    const res = await get(`https://lrclib.net/api/search?${q({ q: [title, artist].filter(Boolean).join(' ') })}`);
    if (!res.ok) return null;
    const list = (await res.json()) as LrcRecord[];
    const hit = list.find((r) => r.plainLyrics?.trim() && r.trackName && similar(r.trackName, title) && (!artist || !r.artistName || similar(r.artistName, artist)))
      ?? list.find((r) => r.plainLyrics?.trim() && r.trackName && similar(r.trackName, title));
    return hit?.plainLyrics?.trim() ?? null;
  } catch { return null; }
}

/** 校验引用：必须能在原文里找到（允许跨最多两行），返回原文里的那几行；找不到返回 null */
export function verifyQuote(quote: string, lyrics: string): string | null {
  const want = norm(quote);
  if (want.length < 2) return null;
  const lines = lyrics.split('\n').map((l) => l.trim()).filter(Boolean);
  const normed = lines.map(norm);
  // 一句在某行里 → 一句跨两行 → 一句比某行长但包含整行（模型多写了几个字）
  for (let i = 0; i < lines.length; i++) if (normed[i]!.length >= 2 && normed[i]!.includes(want)) return lines[i]!;
  for (let i = 0; i + 1 < lines.length; i++) if ((normed[i]! + normed[i + 1]!).includes(want)) return `${lines[i]} / ${lines[i + 1]}`;
  for (let i = 0; i < lines.length; i++) if (normed[i]!.length >= 4 && want.includes(normed[i]!)) return lines[i]!;
  return null;
}

const MAX_LYRICS = 2500;

export async function lookupSong(qr: ShareQuery, f: Fetch = fetch): Promise<ShareResult> {
  const artist = qr.subtitle;
  const meta = await searchItunes(qr.title, artist, f);
  const lyrics = await fetchLyrics(meta?.title ?? qr.title, meta?.artist || artist, meta?.durationSec, f);
  const title = meta?.title ?? qr.title;
  const who = meta?.artist || artist || '';
  const card: ShareCard = {
    type: 'music', subtype: 'song', title, subtitle: who || undefined,
    cover: meta?.cover, preview: meta?.preview,
    links: [
      ...(meta?.url ? [{ label: 'Apple Music', url: meta.url }] : []),
      { label: '网易云搜索', url: `https://music.163.com/#/search/m/?type=1&s=${encodeURIComponent([title, who].filter(Boolean).join(' '))}` },
    ],
    source: [meta ? 'itunes' : '', lyrics ? 'lrclib' : ''].filter(Boolean).join('+') || 'none',
    ...(lyrics ? { extra: { lyricsHead: lyrics.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join('\n') } } : {}),
  };
  const out: string[] = [];
  out.push(`已分享《${title}》${who ? ' - ' + who : ''}${meta?.album ? `（专辑：${meta.album}）` : ''}。卡片已经发给对方${meta ? '，带封面和 30 秒试听' : ''}，不用再描述它。`);
  if (!meta) out.push('没查到这首歌的资料（可能歌名或歌手不准），卡片只带了你给的名字。');
  if (lyrics) {
    const cut = lyrics.length > MAX_LYRICS;
    out.push(`歌词（来自 LRCLIB${cut ? '，太长截断' : ''}）：\n${lyrics.slice(0, MAX_LYRICS)}`);
    if (qr.quote) {
      const hit = verifyQuote(qr.quote, lyrics);
      if (hit) { card.quote = hit; out.push(`你引的「${hit}」已放在卡片上。`); }
      else out.push(`你引的「${qr.quote}」在歌词里没有，已去掉。要引只能引上面的原句。`);
    }
    out.push('回复里要引歌词只能引上面出现的原句，不要改字。');
  } else {
    out.push('没查到这首歌的歌词。不要引用歌词，也不要编，可以聊这首歌给你的感觉。' + (meta ? '' : '如果你能上网，可以用 web_search 确认歌名和歌词再分享。'));
    if (qr.quote) out.push(`你想引的「${qr.quote}」没法核实，已去掉。`);
  }
  out.push('不要向对方复述你查了资料。');
  return { card, forModel: out.join('\n\n') };
}

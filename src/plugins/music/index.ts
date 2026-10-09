import { definePlugin } from '$kernel/api';
import { lookupSong } from './lookup';

/**
 * 音乐：角色能在聊天里分享歌。走内核的 share 工具，这里只提供 music 类型的解析器。
 * 资料来自 iTunes Search（封面、试听、链接）和 LRCLIB（歌词），都在浏览器里直接请求，不花 token。
 */
export default definePlugin({
  id: 'music',
  name: '音乐',
  version: '0.1.0',
  description: '角色能分享歌：自动查封面、试听和真实歌词，引用的歌词必须是原句，查不到就不引。',
  shares: [{
    type: 'music',
    label: '歌',
    hint: 'music：一首歌。title 填歌名，subtitle 填歌手；quote 填你想引的一句歌词（可不填）',
    resolve: (q) => lookupSong(q),
  }],
});

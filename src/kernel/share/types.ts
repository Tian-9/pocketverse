/**
 * 分享卡：角色在聊天里分享一个东西（歌、电影、新闻、链接）的通用结构。
 * 聊天插件只认这一种卡片，按字段有无决定显示什么；类型私有信息放 subtype / extra。
 */
export interface ShareCard {
  /** 大类：music / movie / book / news / link … 由解析器决定 */
  type: string;
  /** 细分，如 music 下的 song / album */
  subtype?: string;
  title: string;
  /** 歌手、导演、作者、媒体名 */
  subtitle?: string;
  /** 封面图 URL */
  cover?: string;
  /** 外链，第一个是主链接 */
  links?: { label: string; url: string }[];
  /** 角色引用的一句（已经过原文校验） */
  quote?: string;
  /** 简介或摘要 */
  excerpt?: string;
  /** 音频试听 URL */
  preview?: string;
  /** 资料来源，如 itunes+lrclib / manual / none */
  source?: string;
  extra?: Record<string, unknown>;
}

/** 模型调 share 工具时给的参数，解析器按 type 分发后拿到 */
export interface ShareQuery {
  type: string;
  title: string;
  subtitle?: string;
  /** 模型想引用的一句，解析器要在原文里校验 */
  quote?: string;
}

export interface ShareResult {
  card: ShareCard;
  /** 给模型看的文本：真实资料（如完整歌词）和使用说明 */
  forModel: string;
}

export interface ShareResolver {
  /** 大类名，进 share 工具的 type 枚举 */
  type: string;
  /** 给人看的名字，如「歌」 */
  label: string;
  /** 给模型看的一句说明：这个类型 title / subtitle 填什么 */
  hint: string;
  resolve(query: ShareQuery): Promise<ShareResult>;
}

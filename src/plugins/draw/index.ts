import { definePlugin, sanitizeSvg, svgDataUrl } from '$kernel/api';
import type { PromptContext, ShareCard, ToolDef } from '$kernel/api';

/**
 * 他画画：一个工具，他把 SVG 写出来，内核清洗后当分享卡的封面显示。
 * 图不回给模型，他只靠 alt 那句话记得画过。没有表、没有界面；要相册再加。
 */
export const STYLE = 'SVG 要求：viewBox="0 0 64 64"（想画横幅可以 0 0 128 64），最多 24 个图形，只用 path / rect / circle / ellipse / line / polyline / polygon / g，3 到 5 种平涂颜色，深色粗描边，不要文字、渐变、滤镜、script、外部链接，背景透明，不要大面积纯白或纯黑。';

export const drawTool: ToolDef = {
  name: 'draw',
  label: '画画',
  modes: ['online'],
  description: `画一张小画给对方看：涂鸦、简笔画、一个表情、一张草图，扁平贴纸风。只在真的想画的时候用，不要每轮都画。title 是画的名字（几个字），svg 是完整的 <svg> 字符串。${STYLE}`,
  inputSchema: { type: 'object', properties: { title: { type: 'string', description: '画的名字' }, svg: { type: 'string', description: '完整的 <svg …>…</svg>' } }, required: ['title', 'svg'] },
  async handler(input: unknown, p: PromptContext) {
    const { title, svg } = (input ?? {}) as { title?: unknown; svg?: unknown };
    const name = String(title ?? '').trim().slice(0, 30) || '一张画';
    const raw = String(svg ?? '');
    const clean = raw.trim().startsWith('<svg') ? sanitizeSvg(raw) : null;
    if (!clean) return `这张 SVG 不合法（解析不了、根不是 svg、太大，或者用了不允许的东西），没画成。${STYLE} 重画一次，或者这次别画。`;
    const card: ShareCard = { type: 'drawing', title: name, cover: svgDataUrl(clean), source: 'draw' };
    p.addCard?.('share', JSON.stringify(card), {}, `[画了一张画：${name}]`);
    return `画好了，《${name}》在对话里。不用再描述画的内容。`;
  },
};

export default definePlugin({
  id: 'draw',
  name: '画画',
  version: '0.1.0',
  description: '他会画画：聊天里想画就画一张小画给你看，扁平贴纸风。',
  tools: [drawTool],
});

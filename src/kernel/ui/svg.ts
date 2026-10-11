/**
 * 模型写的 SVG 只能经这里清洗再显示，而且只能当图片（<img src="data:…">）显示，不能内联进页面。
 * 两道闸：图片里浏览器不执行脚本、不加载外部资源；清洗按白名单删掉一切不认识的元素和属性。
 * 清洗是纯函数，库里只存清洗过的字符串。
 */

export const MAX_SVG_BYTES = 8 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';

const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath']);
const ATTRS = new Set([
  'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'opacity',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'viewBox', 'preserveAspectRatio',
  'id', 'offset', 'stop-color', 'stop-opacity', 'clip-path', 'gradientUnits', 'gradientTransform', 'xmlns',
]);
/** 这些属性的值可以引用 #id（渐变、裁剪），别的 url() 一律不行 */
const REF_ATTRS = new Set(['fill', 'stroke', 'clip-path']);
const REF_OK = /^url\(#[A-Za-z_][\w-]*\)$/;

function badValue(name: string, value: string): boolean {
  const v = value.trim();
  if (/[<>]/.test(v) || /javascript:|expression\(|&#|\\/i.test(v)) return true;
  if (/url\(/i.test(v)) return !(REF_ATTRS.has(name) && REF_OK.test(v));
  return false;
}

function clean(el: Element) {
  for (const a of [...el.attributes]) {
    if (a.namespaceURI && a.namespaceURI !== SVG_NS && a.name !== 'xmlns') { el.removeAttributeNode(a); continue; }
    if (!ATTRS.has(a.name) || badValue(a.name, a.value)) el.removeAttributeNode(a);
  }
  for (const node of [...el.childNodes]) {
    if (node.nodeType === 1) {
      const child = node as Element;
      if (child.namespaceURI !== SVG_NS || !ELEMENTS.has(child.localName)) { el.removeChild(child); continue; }
      clean(child);
    } else if (node.nodeType === 3) {
      if (el.localName !== 'title') el.removeChild(node); // 文本只允许在 title 里
    } else {
      el.removeChild(node); // 注释、CDATA、处理指令
    }
  }
}

/** 清洗模型写的 SVG。解析失败、根不是 svg、太大、带 DOCTYPE 都返回 null；返回的字符串可以直接交给 svgDataUrl */
export function sanitizeSvg(text: string): string | null {
  if (typeof DOMParser === 'undefined') return null;
  const t = text.trim();
  if (!t || t.length > MAX_SVG_BYTES || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(t)) return null;
  const doc = new DOMParser().parseFromString(t, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return null;
  clean(root);
  root.setAttribute('xmlns', SVG_NS);
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', '0 0 64 64');
  const out = new XMLSerializer().serializeToString(root);
  return out.length > MAX_SVG_BYTES ? null : out;
}

/** 清洗过的 SVG 变成 <img src> 能用的 data URL */
export const svgDataUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

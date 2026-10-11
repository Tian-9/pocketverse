// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeSvg, svgDataUrl, MAX_SVG_BYTES } from './svg';

const wrap = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" ${attrs}>${inner}</svg>`;

describe('sanitizeSvg', () => {
  it('keeps plain shapes and their drawing attributes', () => {
    const out = sanitizeSvg(wrap('<circle cx="32" cy="32" r="20" fill="#f5a" stroke="#333" stroke-width="3"/><path d="M4 4L60 60" stroke-linejoin="round"/>'))!;
    expect(out).toContain('<circle cx="32" cy="32" r="20" fill="#f5a" stroke="#333" stroke-width="3"');
    expect(out).toContain('<path d="M4 4L60 60" stroke-linejoin="round"');
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });

  it('drops scripts, event handlers, foreignObject, image, use, a, style and animate', () => {
    const out = sanitizeSvg(wrap(
      '<script>alert(1)</script><rect x="1" y="1" width="10" height="10" onclick="alert(1)" onload="x()"/>' +
      '<foreignObject><div>hi</div></foreignObject><image href="https://evil/x.png"/><use href="#a"/><a href="javascript:alert(1)"><circle r="2"/></a>' +
      '<style>rect{fill:url(https://evil)}</style><animate attributeName="x"/><!-- c --><![CDATA[x]]>',
    ))!;
    for (const bad of ['script', 'onclick', 'onload', 'foreignObject', 'image', '<use', '<a ', 'style', 'animate', 'evil', '<!--', 'CDATA']) expect(out).not.toContain(bad);
    expect(out).toContain('<rect x="1" y="1" width="10" height="10"');
  });

  it('allows url(#id) only on fill, stroke and clip-path; rejects other url() and javascript values', () => {
    const out = sanitizeSvg(wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" stroke="url(https://x)" width="url(#g)" transform="javascript:1"/>'))!;
    expect(out).toContain('fill="url(#g)"');
    expect(out).not.toContain('stroke=');
    expect(out).not.toContain('width=');
    expect(out).not.toContain('transform=');
    expect(out).toContain('<linearGradient id="g">');
  });

  it('removes text outside title and foreign-namespace attributes', () => {
    const out = sanitizeSvg(wrap('<title>面包</title>hello<g xlink:href="#x" xmlns:xlink="http://www.w3.org/1999/xlink"><circle r="1"/></g>'))!;
    expect(out).toContain('<title>面包</title>');
    expect(out).not.toContain('hello');
    expect(out).not.toContain('xlink');
  });

  it('rejects garbage, non-svg roots, doctypes and oversized input', () => {
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('not svg')).toBeNull();
    expect(sanitizeSvg('<svg><circle></svg>')).toBeNull();
    expect(sanitizeSvg('<div xmlns="http://www.w3.org/1999/xhtml"></div>')).toBeNull();
    expect(sanitizeSvg('<svg></svg>')).toBeNull(); // 没有命名空间
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "b">]>' + wrap(''))).toBeNull();
    expect(sanitizeSvg(wrap('<path d="' + 'M0 0 '.repeat(MAX_SVG_BYTES / 5) + '"/>'))).toBeNull();
  });

  it('adds a viewBox when missing and builds a data url', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')!;
    expect(out).toContain('viewBox="0 0 64 64"');
    expect(svgDataUrl(out).startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true);
  });
});

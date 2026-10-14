// The map as a standalone SVG picture, for the PNG export: the same shapes as on the page, with
// every colour and font written on the elements themselves (no stylesheet, no foreignObject, so
// the browser can paint it on a canvas). Pure: it works from the layout alone.
import {
  arrowShape,
  badgeRect,
  branchPaths,
  drawnBounds,
  labelWidth,
  textLines,
  type ShownArrow,
} from "../layout/geometry.ts";
import type { Layout } from "../layout/layout.ts";
import { COLORS, FONT_STACK, STROKE, badgeText, styleOf } from "../layout/theme.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const font = `font-family="${esc(FONT_STACK)}"`;

export interface SvgOptions {
  /** empty space around the map, px */
  pad?: number;
  /** pixels per map unit in the picture */
  scale?: number;
}

/** The picture's size in pixels, before any scaling. */
export function svgSize(layout: Layout, arrows: readonly ShownArrow[], pad = 40): { width: number; height: number } {
  const b = drawnBounds(layout, arrows);
  return { width: Math.ceil(b.w + 2 * pad), height: Math.ceil(b.h + 2 * pad) };
}

/** The map (as laid out) and its arrows as an SVG document. */
export function mapToSvg(layout: Layout, arrows: readonly ShownArrow[], options: SvgOptions = {}): string {
  const pad = options.pad ?? 40;
  const scale = options.scale ?? 1;
  const { width, height } = svgSize(layout, arrows, pad);
  const { x, y } = drawnBounds(layout, arrows);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="${x - pad} ${y - pad} ${width} ${height}">`,
    `<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${COLORS.arrow}"/></marker></defs>`,
    `<rect x="${x - pad}" y="${y - pad}" width="${width}" height="${height}" fill="#ffffff"/>`,
  ];
  const paths = branchPaths(layout);
  out.push(`<path d="${paths.root}" fill="none" stroke="${COLORS.line}" stroke-width="${STROKE.root}"/>`);
  out.push(`<path d="${paths.deep}" fill="none" stroke="${COLORS.line}" stroke-width="${STROKE.deep}"/>`);

  for (const id of layout.order) {
    const box = layout.boxes.get(id)!;
    const style = styleOf(box.level);
    if (box.level === 0) {
      out.push(
        `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${style.radius}" fill="${COLORS.rootFill}"/>`,
      );
    } else if (box.level === 1) {
      out.push(
        `<rect x="${box.x + 0.5}" y="${box.y + 0.5}" width="${box.w - 1}" height="${box.h - 1}" rx="${style.radius}" fill="${COLORS.mainFill}" stroke="${COLORS.mainBorder}"/>`,
      );
    }
    const colour = box.level === 0 ? COLORS.rootText : COLORS.text;
    const anchor = box.level === 0 ? ' text-anchor="middle"' : "";
    for (const line of textLines(box)) {
      if (!line.text) continue;
      out.push(
        `<text x="${line.x}" y="${line.y}" ${font} font-size="${style.size}" font-weight="${style.weight}" fill="${colour}" dominant-baseline="central"${anchor}>${esc(line.text)}</text>`,
      );
    }
    const badge = badgeRect(box);
    if (badge) {
      out.push(
        `<rect x="${badge.x}" y="${badge.y}" width="${badge.w}" height="${badge.h}" rx="${badge.h / 2}" fill="${COLORS.badgeFill}" stroke="${COLORS.mainBorder}"/>`,
        `<text x="${badge.x + badge.w / 2}" y="${badge.y + badge.h / 2}" ${font} font-size="11" fill="${COLORS.badgeText}" dominant-baseline="central" text-anchor="middle">${badgeText(box.hidden)}</text>`,
      );
    }
  }

  for (const shown of arrows) {
    const shape = arrowShape(shown.from, shown.to);
    const opacity = shown.dimmed ? ' opacity="0.45"' : "";
    out.push(
      `<path d="${shape.d}" fill="none" stroke="${COLORS.arrow}" stroke-width="${STROKE.arrow}" stroke-dasharray="6 4" marker-end="url(#head)"${opacity}/>`,
    );
    if (shown.arrow.label) {
      const w = labelWidth(shown.arrow.label);
      out.push(
        `<rect x="${shape.label.x - w / 2}" y="${shape.label.y - 9}" width="${w}" height="18" rx="9" fill="#ffffff" stroke="${COLORS.mainBorder}"${opacity}/>`,
        `<text x="${shape.label.x}" y="${shape.label.y}" ${font} font-size="12" fill="${COLORS.arrow}" dominant-baseline="central" text-anchor="middle"${opacity}>${esc(shown.arrow.label)}</text>`,
      );
    }
  }
  out.push("</svg>");
  return out.join("\n");
}

// How big a node is: its text wrapped to the level's width, and the box around it. Widths come
// from one canvas's measureText in the browser, in the font the map is drawn with; tests pass a
// made-up width instead. Results are kept, since the same texts are measured again on every
// change of the map.
import { FONT_STACK, styleOf, type LevelStyle } from "./theme.ts";
import { wrap } from "./wrap.ts";

/** The width of `text` in px, set in `style`'s font. */
export type WidthOf = (text: string, style: LevelStyle) => number;

export interface Measured {
  lines: string[];
  /** the box */
  w: number;
  h: number;
}

export type Measure = (text: string, level: number) => Measured;

const MAX_KEPT = 20_000;

/** A measure that remembers its results. */
export function createMeasurer(widthOf: WidthOf): Measure {
  const kept = new Map<string, Measured>();
  return (text, level) => {
    const style = styleOf(level);
    const key = `${Math.min(level, 2)}\u0000${text}`;
    const hit = kept.get(key);
    if (hit) return hit;
    const width = (s: string) => widthOf(s, style);
    const lines = wrap(text, style.maxWidth, width);
    const textWidth = Math.max(0, ...lines.map(width));
    const measured: Measured = {
      lines,
      w: Math.max(style.minWidth, Math.ceil(textWidth) + 2 + 2 * style.padX),
      h: lines.length * style.lineHeight + 2 * style.padY,
    };
    if (kept.size >= MAX_KEPT) kept.clear();
    kept.set(key, measured);
    return measured;
  };
}

/** The CSS font of a level, as canvas, SVG and the editor take it. */
export const cssFont = (style: LevelStyle) => `${style.weight} ${style.size}px ${FONT_STACK}`;

/** Widths from a canvas: the browser's own measure of the font the map is drawn in. */
export function canvasWidthOf(): WidthOf {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (text, style) => text.length * style.size * 0.55;
  let font = "";
  return (text, style) => {
    const wanted = cssFont(style);
    if (wanted !== font) ctx.font = font = wanted;
    return ctx.measureText(text).width;
  };
}

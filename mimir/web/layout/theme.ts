// How a map looks: the type and box of each level, the gaps between nodes, and the colours. One
// colour: the suite's stone greys, with Mimir's fuchsia only for the root and the selection. The
// same numbers drive the layout, the page's drawing and the PNG export, so they always agree.

/** Tailwind's sans-serif list: the canvas measures with it, the SVG and the editor draw with it. */
export const FONT_STACK =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

export interface LevelStyle {
  /** font size, px */
  size: number;
  weight: number;
  /** px between baselines */
  lineHeight: number;
  padX: number;
  padY: number;
  /** the widest a line of text may be before it wraps */
  maxWidth: number;
  minWidth: number;
  radius: number;
}

const ROOT: LevelStyle = {
  size: 20,
  weight: 600,
  lineHeight: 26,
  padX: 18,
  padY: 12,
  maxWidth: 280,
  minWidth: 80,
  radius: 12,
};
const MAIN: LevelStyle = {
  size: 16,
  weight: 500,
  lineHeight: 22,
  padX: 12,
  padY: 7,
  maxWidth: 240,
  minWidth: 40,
  radius: 8,
};
const DEEP: LevelStyle = {
  size: 14,
  weight: 400,
  lineHeight: 19,
  padX: 8,
  padY: 4,
  maxWidth: 220,
  minWidth: 24,
  radius: 6,
};

/** The style of a node `level` steps from the root (0). */
export const styleOf = (level: number): LevelStyle => (level === 0 ? ROOT : level === 1 ? MAIN : DEEP);

export const GAP = {
  /** across, from the root to its children */
  root: 56,
  /** across, between deeper levels */
  across: 36,
  /** down, between main branches */
  main: 20,
  /** down, between deeper siblings */
  down: 6,
} as const;

/** Room for the fold badge ("+12") beyond a node's outer edge. */
export const BADGE = { gap: 6, height: 16, minWidth: 22, charWidth: 7 } as const;

export const COLORS = {
  background: "#fafaf9", // stone-50
  line: "#a8a29e", // stone-400
  text: "#292524", // stone-800
  faint: "#a8a29e", // stone-400
  mainFill: "#ffffff",
  mainBorder: "#d6d3d1", // stone-300
  rootFill: "#c026d3", // fuchsia-600
  rootText: "#ffffff",
  select: "#d946ef", // fuchsia-500
  selectSoft: "#fae8ff", // fuchsia-100
  badgeFill: "#f5f5f4", // stone-100
  badgeText: "#57534e", // stone-600
  arrow: "#78716c", // stone-500
  link: "#292524",
  drop: "#c026d3", // fuchsia-600
} as const;

/** Below this zoom, text deeper than the main branches is too small to read: grey bars stand in for it. */
export const SKETCH_ZOOM = 0.45;

/** Stroke widths of the branches: from the root, and deeper. */
export const STROKE = { root: 2.5, deep: 1.5, arrow: 1.5 } as const;

/** What a fold badge says: "+12", "99+" past that. */
export const badgeText = (hidden: number) => (hidden > 99 ? "99+" : `+${hidden}`);

/** A fold badge's width. */
export const badgeWidth = (hidden: number) => Math.max(BADGE.minWidth, badgeText(hidden).length * BADGE.charWidth + 10);

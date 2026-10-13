// Fixed class names for board and label colours: Tailwind only finds classes written out whole.
import type { Color } from "../shared/protocol.ts";

export const COLOR_CLASSES: Record<Color, { dot: string; chip: string }> = {
  green: { dot: "bg-green-500", chip: "bg-green-600 text-white" },
  yellow: { dot: "bg-yellow-400", chip: "bg-yellow-400 text-yellow-950" },
  orange: { dot: "bg-orange-500", chip: "bg-orange-500 text-white" },
  red: { dot: "bg-red-500", chip: "bg-red-600 text-white" },
  purple: { dot: "bg-purple-500", chip: "bg-purple-600 text-white" },
  blue: { dot: "bg-blue-500", chip: "bg-blue-600 text-white" },
  sky: { dot: "bg-sky-400", chip: "bg-sky-500 text-white" },
  teal: { dot: "bg-teal-500", chip: "bg-teal-600 text-white" },
  pink: { dot: "bg-pink-500", chip: "bg-pink-500 text-white" },
  stone: { dot: "bg-stone-500", chip: "bg-stone-500 text-white" },
};

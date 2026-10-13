// Fixed class names for calendar colours: Tailwind only finds classes written out whole.
import type { Color } from "../shared/protocol.ts";

export const CAL_COLORS: Record<Color, { dot: string; bar: string; soft: string; text: string }> = {
  indigo: { dot: "bg-indigo-500", bar: "bg-indigo-500 text-white", soft: "bg-indigo-50", text: "text-indigo-800" },
  sky: { dot: "bg-sky-500", bar: "bg-sky-500 text-white", soft: "bg-sky-50", text: "text-sky-800" },
  teal: { dot: "bg-teal-500", bar: "bg-teal-600 text-white", soft: "bg-teal-50", text: "text-teal-800" },
  emerald: { dot: "bg-emerald-500", bar: "bg-emerald-600 text-white", soft: "bg-emerald-50", text: "text-emerald-800" },
  lime: { dot: "bg-lime-500", bar: "bg-lime-600 text-white", soft: "bg-lime-50", text: "text-lime-800" },
  amber: { dot: "bg-amber-500", bar: "bg-amber-500 text-amber-950", soft: "bg-amber-50", text: "text-amber-800" },
  orange: { dot: "bg-orange-500", bar: "bg-orange-500 text-white", soft: "bg-orange-50", text: "text-orange-800" },
  rose: { dot: "bg-rose-500", bar: "bg-rose-500 text-white", soft: "bg-rose-50", text: "text-rose-800" },
  fuchsia: { dot: "bg-fuchsia-500", bar: "bg-fuchsia-500 text-white", soft: "bg-fuchsia-50", text: "text-fuchsia-800" },
  stone: { dot: "bg-stone-500", bar: "bg-stone-500 text-white", soft: "bg-stone-100", text: "text-stone-800" },
};

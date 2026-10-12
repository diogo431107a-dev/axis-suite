// Fixed class names for journal colours and moods: Tailwind only finds classes written out whole.
import type { Color, Mood } from "../shared/protocol.ts";

export const JOURNAL_COLORS: Record<Color, { dot: string; soft: string; text: string }> = {
  amber: { dot: "bg-amber-500", soft: "bg-amber-50", text: "text-amber-800" },
  rose: { dot: "bg-rose-500", soft: "bg-rose-50", text: "text-rose-800" },
  emerald: { dot: "bg-emerald-500", soft: "bg-emerald-50", text: "text-emerald-800" },
  sky: { dot: "bg-sky-500", soft: "bg-sky-50", text: "text-sky-800" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-50", text: "text-violet-800" },
  teal: { dot: "bg-teal-500", soft: "bg-teal-50", text: "text-teal-800" },
  orange: { dot: "bg-orange-500", soft: "bg-orange-50", text: "text-orange-800" },
  stone: { dot: "bg-stone-500", soft: "bg-stone-100", text: "text-stone-800" },
};

/** From red (awful) to green (great), each with its name for people who don't see the colour. */
export const MOOD_COLORS: Record<Mood, { bg: string; soft: string; text: string }> = {
  1: { bg: "bg-red-500", soft: "bg-red-50", text: "text-red-800" },
  2: { bg: "bg-orange-400", soft: "bg-orange-50", text: "text-orange-800" },
  3: { bg: "bg-yellow-400", soft: "bg-yellow-50", text: "text-yellow-800" },
  4: { bg: "bg-lime-500", soft: "bg-lime-50", text: "text-lime-800" },
  5: { bg: "bg-emerald-600", soft: "bg-emerald-50", text: "text-emerald-800" },
};

/** A day written without a mood. */
export const NO_MOOD = "bg-stone-400";

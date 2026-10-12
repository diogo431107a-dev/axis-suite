// Fixed class names for group and avatar colours: Tailwind only finds classes written out whole.
import type { Color } from "../shared/protocol.ts";

export const GROUP_COLORS: Record<Color, { dot: string; soft: string; text: string }> = {
  teal: { dot: "bg-teal-500", soft: "bg-teal-50", text: "text-teal-800" },
  sky: { dot: "bg-sky-500", soft: "bg-sky-50", text: "text-sky-800" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-50", text: "text-violet-800" },
  rose: { dot: "bg-rose-500", soft: "bg-rose-50", text: "text-rose-800" },
  amber: { dot: "bg-amber-500", soft: "bg-amber-50", text: "text-amber-800" },
  emerald: { dot: "bg-emerald-500", soft: "bg-emerald-50", text: "text-emerald-800" },
  orange: { dot: "bg-orange-500", soft: "bg-orange-50", text: "text-orange-800" },
  stone: { dot: "bg-stone-500", soft: "bg-stone-100", text: "text-stone-800" },
};

const AVATARS = [
  "bg-teal-100 text-teal-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-orange-100 text-orange-800",
  "bg-indigo-100 text-indigo-800",
];

/** An avatar's colours, the same for a contact every time. */
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATARS[Math.abs(h) % AVATARS.length]!;
}

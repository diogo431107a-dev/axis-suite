// A date-and-time widget's value, and the moment it comes to.
import type { Band, Precision, Stamp } from "../../shared/protocol.ts";
import { clock, isoDate, parseDateText } from "../time.ts";

export interface DateTimeValue {
  text: string;
  prec: Precision;
  /** How the hour is known. */
  mode: "exact" | "unknown" | Band;
  time: string;
}

/** A widget's starting value: this very moment, unless a stamp is given. */
export function dateTimeFrom(stamp: Stamp | null): DateTimeValue {
  if (!stamp) return { text: isoDate(), prec: "date", mode: "exact", time: clock() };
  const exact = stamp.t !== null && /\d/.test(stamp.t);
  return {
    text: stamp.p === "around" ? `~${stamp.d}` : stamp.d,
    prec: stamp.p,
    mode: exact ? "exact" : stamp.t ? (stamp.t as Band) : stamp.p === "date" ? "unknown" : "exact",
    time: exact && stamp.t ? stamp.t : "12:00",
  };
}

/** The moment chosen, or null if the date can't be read. */
export function readDateTime(value: DateTimeValue, today: string): Stamp | null {
  const parsed = parseDateText(value.text, today);
  if (!parsed) return null;
  if (parsed.p !== "date") return { d: parsed.d, t: null, p: parsed.p };
  const t = value.mode === "exact" ? value.time : value.mode === "unknown" ? null : value.mode;
  return { d: parsed.d, t, p: "date" };
}

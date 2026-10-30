// What a form's dollars need: "type the dollars instead" and the day's rate. Apart from Dollars.tsx so
// that file only exports a component.
import { useEffect, useState } from "react";
import type { Currency, IsoDate, Rate } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { parseAmount } from "../format.ts";

/** Whether the user is typing the dollars themselves, and what they typed. */
export function useTypedDollars() {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  return { typing, setTyping, text, setText };
}
export type TypedDollars = ReturnType<typeof useTypedDollars>;

/**
 * The dollars to send with a save, with the sign of `cents`. undefined means "work them out from the
 * rate"; null means what was typed can't be read.
 */
export function typedUsd(
  typed: TypedDollars,
  currency: Currency | undefined,
  cents: number,
): number | undefined | null {
  if (currency !== "BRL" || !typed.typing) return undefined;
  const usd = parseAmount(typed.text);
  if (usd === null) return null;
  return cents < 0 ? -Math.abs(usd) : Math.abs(usd);
}

/** The rate of a day. `loading` is true until the answer for this very date is in. */
export function useRate(date: IsoDate, enabled: boolean): { loading: boolean; rate: Rate | null } {
  const [answer, setAnswer] = useState<{ date: IsoDate; rate: Rate | null } | null>(null);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  useEffect(() => {
    if (!enabled || !validDate) return;
    let cancelled = false;
    void api<{ rate: Rate | null }>(`/api/rate?date=${date}`)
      .then(({ rate }) => {
        if (!cancelled) setAnswer({ date, rate });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ date, rate: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, validDate, date]);

  return answer?.date === date ? { loading: false, rate: answer.rate } : { loading: true, rate: null };
}

/** An amount in the other currency at a rate, for suggesting what to type. */
export function convert(cents: number, from: Currency, to: Currency, rate: Rate): number {
  if (from === to) return cents;
  return Math.round(from === "BRL" ? cents / rate.value : cents * rate.value);
}

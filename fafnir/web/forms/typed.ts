// What a form's dollars need: "type the dollars instead" and the day's rates. Apart from Dollars.tsx
// so that file only exports a component.
import { useEffect, useState } from "react";
import { unitOf } from "../../shared/currencies.ts";
import type { Currency, IsoDate, Rate, RatedCurrency } from "../../shared/protocol.ts";
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
 * The dollars to send with a save, with the sign of `amount`. undefined means "work them out from the
 * rate"; null means what was typed can't be read.
 */
export function typedUsd(
  typed: TypedDollars,
  currency: Currency | undefined,
  amount: number,
): number | undefined | null {
  if (currency === undefined || currency === "USD" || !typed.typing) return undefined;
  const usd = parseAmount(typed.text);
  if (usd === null) return null;
  return amount < 0 ? -Math.abs(usd) : Math.abs(usd);
}

export type DayRates = Record<RatedCurrency, Rate | null>;

/** Every currency's rate on a day. `loading` is true until the answer for this very date is in. */
export function useRates(date: IsoDate, enabled: boolean): { loading: boolean; rates: DayRates | null } {
  const [answer, setAnswer] = useState<{ date: IsoDate; rates: DayRates | null } | null>(null);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  useEffect(() => {
    if (!enabled || !validDate) return;
    let cancelled = false;
    void api<DayRates>(`/api/rates?date=${date}`)
      .then((rates) => {
        if (!cancelled) setAnswer({ date, rates });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ date, rates: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, validDate, date]);

  return answer?.date === date ? { loading: false, rates: answer.rates } : { loading: true, rates: null };
}

/**
 * An amount in another currency at the day's rates, for suggesting what to type; null if a rate is
 * missing. It goes through dollars without rounding on the way, so a few satoshis don't come out as zero.
 */
export function convert(amount: number, from: Currency, to: Currency, rates: DayRates | null): number | null {
  if (from === to) return amount;
  const rateOf = (currency: RatedCurrency) => rates?.[currency]?.value;

  let cents = amount;
  if (from !== "USD") {
    const rate = rateOf(from);
    if (rate === undefined) return null;
    cents = from === "BRL" ? amount / rate : (amount / unitOf(from)) * rate * 100;
  }
  if (to === "USD") return Math.round(cents);
  const rate = rateOf(to);
  if (rate === undefined) return null;
  return Math.round(to === "BRL" ? cents * rate : (cents / 100 / rate) * unitOf(to));
}

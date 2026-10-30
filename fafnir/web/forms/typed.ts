// A form's "type the dollars instead", apart from Dollars.tsx so that file only exports a component.
import { useState } from "react";
import type { Currency } from "../../shared/protocol.ts";
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

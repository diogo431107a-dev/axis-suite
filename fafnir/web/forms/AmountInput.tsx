import type { Currency } from "../../shared/protocol.ts";
import { symbolOf } from "../format.ts";

/** A large amount field, with the currency's symbol in front. */
export function AmountInput({
  currency,
  value,
  onChange,
}: {
  currency: Currency | undefined;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <div className="amount-input">
      <span aria-hidden>{symbolOf(currency)}</span>
      <input
        inputMode="decimal"
        autoComplete="off"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
      />
    </div>
  );
}

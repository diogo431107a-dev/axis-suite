import type { Currency, IsoDate } from "../../shared/protocol.ts";
import { money, showDate } from "../format.ts";
import { useRate, type TypedDollars } from "./typed.ts";

interface DollarsProps {
  currency: Currency | undefined;
  /** What was typed, in cents; null while it can't be read. */
  cents: number | null;
  date: IsoDate;
  typed: TypedDollars;
  /** The dollars already saved, if the amount and the date are as they were. */
  saved?: number | undefined;
}

/** Under an amount in reais: what it is in dollars, the rate behind that, and a way to type it instead. */
export function Dollars({ currency, cents, date, typed, saved }: DollarsProps) {
  const brl = currency === "BRL";
  const { loading, rate } = useRate(date, brl);

  if (!brl) return null;

  if (typed.typing) {
    return (
      <div className="dollars">
        <label className="field">
          <span>In US dollars</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={typed.text}
            onChange={(e) => typed.setText(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <button type="button" className="link" onClick={() => typed.setTyping(false)}>
          Work it out from the exchange rate
        </button>
      </div>
    );
  }

  const typeInstead = (
    <button type="button" className="link" onClick={() => typed.setTyping(true)}>
      Type the dollars instead
    </button>
  );

  if (saved !== undefined) {
    return (
      <p className="dollars">
        Saved as <strong>{money(saved)}</strong>. {typeInstead}
      </p>
    );
  }
  if (loading) return <p className="dollars muted">Finding the exchange rate…</p>;
  if (!rate) {
    return <p className="dollars">No exchange rate is available for that day. {typeInstead}</p>;
  }
  const { value, source } = rate;
  return (
    <p className="dollars">
      {cents !== null && cents !== 0 && (
        <>
          About <strong>{money(Math.round(Math.abs(cents) / value))}</strong>.{" "}
        </>
      )}
      <span className="muted">
        US$ 1 = R$ {value.toFixed(4)}, {source}, {showDate(rate.date)}.
      </span>{" "}
      {typeInstead}
    </p>
  );
}

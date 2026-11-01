import { isCoin, usdCents } from "../../shared/currencies.ts";
import { USDC_PEG, type Currency, type IsoDate, type Rate } from "../../shared/protocol.ts";
import { money, parseAmount, showDate } from "../format.ts";
import { useRates, type TypedDollars } from "./typed.ts";

interface DollarsProps {
  currency: Currency | undefined;
  /** What was typed, in the currency's smallest unit; null while it can't be read. */
  amount: number | null;
  date: IsoDate;
  typed: TypedDollars;
  /** The dollars already saved, if the amount and the date are as they were. */
  saved?: number | undefined;
  /** For what you already held: the dollars are what it cost, which isn't always what it's worth. */
  asCost?: boolean;
}

function RateLine({ rate }: { rate: Rate }) {
  const when = `${rate.source === USDC_PEG ? "" : `${rate.source}, `}${showDate(rate.date)}`;
  if (rate.source === USDC_PEG) return <>1 USDC counts as $1.00.</>;
  if (rate.currency === "BRL") {
    return (
      <>
        US$ 1 = R$ {rate.value.toFixed(4)}, {when}.
      </>
    );
  }
  return (
    <>
      1 {rate.currency} = {money(Math.round(rate.value * 100))}, {when}.
    </>
  );
}

/** Under an amount: what it is in dollars, the rate behind that, and a way to type it instead. */
export function Dollars({ currency, amount, date, typed, saved, asCost }: DollarsProps) {
  const needed = currency !== undefined && currency !== "USD";
  const { loading, rates } = useRates(date, needed);

  if (!needed) return null;

  if (typed.typing) {
    return (
      <div className="dollars">
        <label className="field">
          <span>{asCost ? "What it cost you, in US dollars" : "In US dollars"}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={typed.text}
            onChange={(e) => typed.setText(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <button type="button" className="link" onClick={() => typed.setTyping(false)}>
          Work it out from the day's {isCoin(currency) ? "price" : "rate"}
        </button>
      </div>
    );
  }

  const typeInstead = (
    <button type="button" className="link" onClick={() => typed.setTyping(true)}>
      {asCost ? "Type what it cost you instead" : "Type the dollars instead"}
    </button>
  );

  if (saved !== undefined) {
    return (
      <p className="dollars">
        Saved as <strong>{money(saved)}</strong>. {typeInstead}
      </p>
    );
  }
  if (loading) return <p className="dollars muted">Finding the {isCoin(currency) ? "price" : "exchange rate"}…</p>;
  const rate = rates?.[currency] ?? null;
  if (!rate) {
    return (
      <p className="dollars">
        No {isCoin(currency) ? "price" : "exchange rate"} is available for that day. {typeInstead}
      </p>
    );
  }
  return (
    <p className="dollars">
      {amount !== null && amount !== 0 && (
        <>
          About <strong>{money(usdCents(Math.abs(amount), currency, rate.value))}</strong>
          {asCost ? ", which counts as what it cost you" : ""}.{" "}
        </>
      )}
      <span className="muted">
        <RateLine rate={rate} />
      </span>{" "}
      {typeInstead}
    </p>
  );
}

/** For a coin, what Fafnir read from what was typed, in full: a slip here costs real money. */
export function ReadAs({ text, currency }: { text: string; currency: Currency | undefined }) {
  if (!isCoin(currency) || text.trim() === "") return null;
  const amount = parseAmount(text, currency);
  return <small>{amount === null ? "That doesn't read as an amount." : `Read as ${money(amount, currency)}.`}</small>;
}

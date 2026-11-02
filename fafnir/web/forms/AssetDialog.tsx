import { useState, type FormEvent } from "react";
import { CURRENCY_INFO, FIAT } from "../../shared/currencies.ts";
import { hasOwnPage, type Book, type Currency, type NewAccount, type NewEntry } from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, parseAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

/** Adds something the user owns: bought now through an account or a loan, or already theirs. */
export function AssetDialog({ book, onClose, onSaved }: { book: Book; onClose: () => void; onSaved: () => void }) {
  // Made once, so trying again after a refusal doesn't add it twice.
  const [assetId] = useState(() => crypto.randomUUID());
  const [entryId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [owned, setOwned] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [payer, setPayer] = useState("");
  const [date, setDate] = useState(localDate());
  const [memo, setMemo] = useState("");
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // It can be paid from an account, or straight from a loan when it was financed. Accounts come first.
  const payers = book.accounts
    .filter((a) => !a.closed && a.currency === currency && (!hasOwnPage(a.kind) || a.kind === "borrowed"))
    .sort((a, b) => Number(a.kind === "borrowed") - Number(b.kind === "borrowed"));
  const chosen = payers.find((a) => a.id === payer)?.id ?? payers[0]?.id ?? "";
  const alreadyOwned = owned || payers.length === 0;
  const amount = parseAmount(amountText, currency);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Give it a name, like the car's model.");
    if (amount === null || amount <= 0) return setError("Type the amount, like 62,000.00.");
    if (!date) return setError("Pick a date.");
    const usd = typedUsd(typed, currency, amount);
    if (usd === null) return setError("Type the US dollar amount, like 18.45.");

    setSaving(true);
    try {
      const asset: NewAccount = {
        id: assetId,
        name,
        kind: "asset",
        currency,
        ...(alreadyOwned ? { starting: amount, date, ...(usd === undefined ? {} : { usd }) } : {}),
      };
      await api("/api/accounts", { method: "POST", body: asset });
      if (!alreadyOwned) {
        const purchase: NewEntry = {
          id: entryId,
          kind: "moved",
          date,
          memo,
          account: chosen,
          other: assetId,
          amount,
          ...(usd === undefined ? {} : { usd }),
        };
        await api("/api/entries", { method: "POST", body: purchase });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "no-rate") typed.setTyping(true);
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Add something I own" onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        <label className="field">
          <span>What is it?</span>
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="Honda Fit, Apartment…"
          />
        </label>

        <label className="field">
          <span>Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {FIAT.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_INFO[c].name} ({c})
              </option>
            ))}
          </select>
        </label>

        {payers.length > 0 && (
          <div className="segmented two-up loan-how" role="radiogroup" aria-label="How you came to own it">
            <button
              type="button"
              role="radio"
              aria-checked={!owned}
              className={owned ? "" : "on"}
              onClick={() => setOwned(false)}
            >
              I bought it
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={owned}
              className={owned ? "on" : ""}
              onClick={() => setOwned(true)}
            >
              I already own it
            </button>
          </div>
        )}

        <label className="field">
          <span>{alreadyOwned ? "What is it worth today?" : "What did you pay?"}</span>
          <AmountInput currency={currency} value={amountText} onChange={setAmountText} />
          <small>
            {alreadyOwned
              ? "Your best guess, like a car's FIPE price. You can give it a new value whenever you like."
              : "What it cost. Taxes or fees on top are ordinary spending."}
          </small>
        </label>
        <Dollars currency={currency} amount={amount} date={date} typed={typed} />

        {!alreadyOwned && (
          <label className="field">
            <span>Paid from</span>
            <select value={chosen} onChange={(e) => setPayer(e.target.value)}>
              {payers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.kind === "borrowed" ? " (loan)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="two">
          <label className="field">
            <span>{alreadyOwned ? "As of which day?" : "Date"}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {!alreadyOwned && (
            <label className="field">
              <span>Note (optional)</span>
              <input value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
            </label>
          )}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Add it"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

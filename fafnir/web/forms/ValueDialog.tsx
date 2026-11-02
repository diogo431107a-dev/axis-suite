import { useState, type FormEvent } from "react";
import type { MoneyAccount, NewValue } from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, money, parseAmount, plainAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

/** A new value for something the user owns, recorded as the difference. */
export function ValueDialog({
  asset,
  onClose,
  onSaved,
}: {
  asset: MoneyAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currency } = asset;
  const [id] = useState(() => crypto.randomUUID());
  const [text, setText] = useState(plainAmount(asset.balance, currency));
  const [date, setDate] = useState(localDate());
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const value = parseAmount(text, currency);
  const difference = value === null ? null : value - asset.balance;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (value === null || value < 0) return setError("Type what it's worth, like 58,000.00.");
    if (!date) return setError("Pick a date.");
    const usd = typedUsd(typed, currency, difference ?? 0);
    if (usd === null) return setError("Type the US dollar amount of the difference, like 18.45.");
    setSaving(true);
    try {
      const body: NewValue = { id, date, value, ...(usd === undefined ? {} : { usd }) };
      await api(`/api/accounts/${asset.id}/value`, { method: "POST", body });
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "no-rate") typed.setTyping(true);
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title={`New value: ${asset.name}`} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        <p className="lead">
          What is it worth now? Your best guess will do, like a car's FIPE price or a valuation. The difference shows on
          Home as a value change, not as spending.
        </p>
        <div className="two">
          <label className="field">
            <span>Worth now</span>
            <AmountInput currency={currency} value={text} onChange={setText} />
          </label>
          <label className="field">
            <span>On what day?</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {difference !== null && difference !== 0 && (
          <p className="dollars">
            That's <strong>{money(Math.abs(difference), currency)}</strong> {difference > 0 ? "more" : "less"} than its
            value so far.
          </p>
        )}
        {typed.typing && <Dollars currency={currency} amount={difference} date={date} typed={typed} />}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving || difference === 0}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

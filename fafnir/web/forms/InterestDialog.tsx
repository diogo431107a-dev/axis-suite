import { useState, type FormEvent } from "react";
import type { Entry, EntryChange, MoneyAccount, NewEntry } from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, parseAmount, plainAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";
import { DeleteEntry } from "./DeleteEntry.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

/** Adds interest to a loan with no money moving, so its balance matches the statement, or changes it. */
export function InterestDialog({
  loan,
  entry,
  onClose,
  onSaved,
}: {
  loan: MoneyAccount;
  entry?: Entry | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currency } = loan;
  const borrowed = loan.kind === "borrowed";
  const [id] = useState(() => crypto.randomUUID());
  const [text, setText] = useState(entry ? plainAmount(entry.amount, currency) : "");
  const [date, setDate] = useState(entry?.date ?? localDate());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(text, currency);
  const unchanged = entry && amount === entry.amount && date === entry.date;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (amount === null || amount <= 0) return setError("Type the interest, like 45.00.");
    if (!date) return setError("Pick a date.");
    const usd = typedUsd(typed, currency, amount);
    if (usd === null) return setError("Type the US dollar amount, like 18.45.");
    const details = {
      kind: "interest" as const,
      date,
      memo,
      account: loan.id,
      amount,
      ...(usd === undefined ? {} : { usd }),
    };
    setSaving(true);
    try {
      if (entry) {
        const change: EntryChange = details;
        await api(`/api/entries/${entry.id}`, { method: "PUT", body: change });
      } else {
        const created: NewEntry = { ...details, id };
        await api("/api/entries", { method: "POST", body: created });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "no-rate") typed.setTyping(true);
      setError(describeError(err));
      setSaving(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setSaving(true);
    try {
      await api(`/api/entries/${entry.id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title={`${entry ? "Change interest" : "Add interest"}: ${loan.name}`} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        <p className="lead">
          {borrowed
            ? "For interest added to what you owe, with no payment made. It counts as spending."
            : "For interest added to what you're owed, with no payment made. It counts as income."}
        </p>
        <label className="field">
          <span>How much interest?</span>
          <AmountInput currency={currency} value={text} onChange={setText} />
        </label>
        <Dollars
          currency={currency}
          amount={amount}
          date={date}
          typed={typed}
          saved={unchanged ? entry.usd : undefined}
        />
        <div className="two">
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Note (optional)</span>
            <input value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {entry && <DeleteEntry disabled={saving} onDelete={() => void remove()} />}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : entry ? "Save changes" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

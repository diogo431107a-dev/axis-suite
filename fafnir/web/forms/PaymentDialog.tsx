import { useState, type FormEvent } from "react";
import {
  hasOwnPage,
  type Book,
  type Entry,
  type EntryChange,
  type MoneyAccount,
  type NewEntry,
} from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, money, parseAmount, plainAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";
import { DeleteEntry } from "./DeleteEntry.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

/** Records a payment on a loan, or changes one: a total, and how much of it was interest. */
export function PaymentDialog({
  book,
  loan,
  lastTotal,
  entry,
  onClose,
  onSaved,
}: {
  book: Book;
  loan: MoneyAccount;
  /** The last payment's total, to start from. */
  lastTotal?: number | null | undefined;
  entry?: Entry | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currency } = loan;
  const borrowed = loan.kind === "borrowed";
  const [id] = useState(() => crypto.randomUUID());
  const accounts = book.accounts.filter(
    (a) => a.currency === currency && !hasOwnPage(a.kind) && (!a.closed || a.id === entry?.account),
  );
  const start = entry?.amount ?? lastTotal;
  const [totalText, setTotalText] = useState(start ? plainAmount(start, currency) : "");
  const [interestText, setInterestText] = useState(entry?.interest ? plainAmount(entry.interest.amount, currency) : "");
  const [account, setAccount] = useState(entry?.account ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(entry?.date ?? localDate());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const total = parseAmount(totalText, currency);
  const interest = interestText.trim() === "" ? 0 : parseAmount(interestText, currency);
  const offLoan = total !== null && interest !== null ? total - interest : null;
  // What's owed before this payment: changing one puts its own part back first.
  const owed = (borrowed ? -loan.balance : loan.balance) + (entry ? entry.amount - (entry.interest?.amount ?? 0) : 0);
  const left = offLoan === null ? null : owed - offLoan;
  const unchanged =
    entry && total === entry.amount && interest === (entry.interest?.amount ?? 0) && date === entry.date;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (total === null || total <= 0) return setError("Type the total, like 780.00.");
    if (interest === null || interest < 0) return setError("Type the interest, like 280.00, or leave it empty.");
    if (interest > total) return setError("The interest can't be more than the whole payment.");
    if (!account) return setError(`Pick the account it went through.`);
    if (!date) return setError("Pick a date.");
    const usd = typedUsd(typed, currency, total);
    if (usd === null) return setError("Type the US dollar amount, like 18.45.");

    const details = {
      kind: borrowed ? ("repaid" as const) : ("collected" as const),
      date,
      memo,
      account,
      other: loan.id,
      amount: total,
      ...(interest > 0 ? { interest } : {}),
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
    <Dialog title={`${entry ? "Change payment" : "Record a payment"}: ${loan.name}`} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        {accounts.length === 0 && (
          <p className="form-error" role="alert">
            You have no {currency} account for this. A loan is paid in its own currency, so add one, or record an
            Exchanged first.
          </p>
        )}

        <label className="field">
          <span>{borrowed ? "How much did you pay?" : "How much did you get?"}</span>
          <AmountInput currency={currency} value={totalText} onChange={setTotalText} />
          {!entry && lastTotal && <small>Starts from your last payment. Change it if this one was different.</small>}
        </label>
        <Dollars
          currency={currency}
          amount={total}
          date={date}
          typed={typed}
          saved={unchanged ? entry.usd : undefined}
        />

        <label className="field">
          <span>Of which interest (optional)</span>
          <AmountInput currency={currency} value={interestText} onChange={setInterestText} />
          <small>
            Your statement usually says. It counts as {borrowed ? "spending" : "income"}, and the rest comes off the
            loan.
          </small>
        </label>

        {offLoan !== null && offLoan >= 0 && left !== null && (
          <p className="dollars">
            <strong>{money(offLoan, currency)}</strong> comes off the loan
            {left >= 0 ? (
              <>
                , leaving <strong>{money(left, currency)}</strong>.
              </>
            ) : (
              "."
            )}
          </p>
        )}
        {left !== null && left < 0 && (
          <p className="notice" role="status">
            That's {money(-left, currency)} more than what's left, so the loan will show as overpaid. You can still save
            it.
          </p>
        )}

        <label className="field">
          <span>{borrowed ? "Paid from" : "Into"}</span>
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

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

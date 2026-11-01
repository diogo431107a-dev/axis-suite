import { useState, type FormEvent } from "react";
import { CURRENCY_INFO, FIAT } from "../../shared/currencies.ts";
import {
  isLoan,
  type Book,
  type Currency,
  type LoanKind,
  type NewAccount,
  type NewEntry,
} from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, money, parseAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

/** Adds a loan: new money through one of the user's accounts, or an older one with what's left of it. */
export function LoanDialog({ book, onClose, onSaved }: { book: Book; onClose: () => void; onSaved: () => void }) {
  // Made once, so trying again after a refusal doesn't make a second loan or a second entry.
  const [loanId] = useState(() => crypto.randomUUID());
  const [entryId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<LoanKind>("borrowed");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [older, setOlder] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [account, setAccount] = useState("");
  const [hasFee, setHasFee] = useState(false);
  const [feeText, setFeeText] = useState("");
  const [date, setDate] = useState(localDate());
  const [memo, setMemo] = useState("");
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const borrowed = kind === "borrowed";
  const accounts = book.accounts.filter((a) => !a.closed && !isLoan(a.kind) && a.currency === currency);
  const chosen = accounts.find((a) => a.id === account)?.id ?? accounts[0]?.id ?? "";
  // With no account in this currency, an older loan is all it can be.
  const asOlder = older || accounts.length === 0;
  const amount = parseAmount(amountText, currency);
  const fee = !asOlder && borrowed && hasFee && feeText.trim() !== "" ? parseAmount(feeText, currency) : 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Say who or what it's for, like the bank or the person.");
    if (amount === null || amount <= 0) return setError("Type the amount, like 10,000.00.");
    if (fee === null || fee < 0) return setError("Type the fee, like 200.00.");
    if (fee >= amount) return setError("The fee has to be less than what was borrowed.");
    if (!date) return setError("Pick a date.");
    const starting = borrowed ? -amount : amount;
    const usd = typedUsd(typed, currency, asOlder ? starting : amount);
    if (usd === null) return setError("Type the US dollar amount, like 18.45.");

    setSaving(true);
    try {
      const loan: NewAccount = {
        id: loanId,
        name,
        kind,
        currency,
        ...(asOlder ? { starting, date, ...(usd === undefined ? {} : { usd }) } : {}),
      };
      await api("/api/accounts", { method: "POST", body: loan });
      if (!asOlder) {
        // New money: out of the loan into the account when borrowing, the other way when lending.
        const move: NewEntry = {
          id: entryId,
          kind: "moved",
          date,
          memo,
          account: borrowed ? loanId : chosen,
          other: borrowed ? chosen : loanId,
          amount,
          ...(usd === undefined ? {} : { usd }),
          ...(fee > 0 ? { fee } : {}),
        };
        await api("/api/entries", { method: "POST", body: move });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "no-rate") typed.setTyping(true);
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Add a loan" onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        <div className="segmented two-up" role="radiogroup" aria-label="Which way the loan goes">
          <button
            type="button"
            role="radio"
            aria-checked={borrowed}
            className={borrowed ? "on" : ""}
            onClick={() => setKind("borrowed")}
          >
            I borrowed
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!borrowed}
            className={borrowed ? "" : "on"}
            onClick={() => setKind("lent")}
          >
            I lent
          </button>
        </div>

        <label className="field">
          <span>{borrowed ? "Who from, or what for?" : "Who to?"}</span>
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder={borrowed ? "Caixa car loan" : "Bruno"}
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

        {accounts.length > 0 && (
          <div className="segmented two-up loan-how" role="radiogroup" aria-label="How this loan began">
            <button
              type="button"
              role="radio"
              aria-checked={!older}
              className={older ? "" : "on"}
              onClick={() => setOlder(false)}
            >
              It's new
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={older}
              className={older ? "on" : ""}
              onClick={() => setOlder(true)}
            >
              It's an older loan
            </button>
          </div>
        )}

        <label className="field">
          <span>
            {asOlder ? `What's left of it?` : borrowed ? "How much did you borrow?" : "How much did you lend?"}
          </span>
          <AmountInput currency={currency} value={amountText} onChange={setAmountText} />
          {asOlder && <small>Only what's still owed today. It doesn't count as money in or out.</small>}
        </label>
        <Dollars currency={currency} amount={amount} date={date} typed={typed} />

        {!asOlder && (
          <label className="field">
            <span>{borrowed ? "Which account did it reach?" : "Which account did it leave?"}</span>
            <select value={chosen} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!asOlder &&
          borrowed &&
          (hasFee ? (
            <label className="field">
              <span>The fee taken out of it</span>
              <AmountInput currency={currency} value={feeText} onChange={setFeeText} />
              {amount !== null && fee !== null && fee > 0 && fee < amount && (
                <small>
                  {money(amount - fee, currency)} reaches your account. The fee goes to your spending, under Fees.
                </small>
              )}
            </label>
          ) : (
            <button type="button" className="link foreign-toggle" onClick={() => setHasFee(true)}>
              A fee was taken out of it
            </button>
          ))}

        <div className="two">
          <label className="field">
            <span>{asOlder ? "As of which day?" : "Date"}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {!asOlder && (
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
            {saving ? "Saving…" : "Add loan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

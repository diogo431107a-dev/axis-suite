import { useState, type FormEvent } from "react";
import type { BalanceCheck, BalanceCheckResult, MoneyAccount } from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, money, parseAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

/** Check balance: compares what the bank shows with what is recorded, and adds any difference. */
export function CheckDialog({
  account,
  onClose,
  onSaved,
}: {
  account: MoneyAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [text, setText] = useState("");
  const [date, setDate] = useState(localDate());
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BalanceCheckResult | null>(null);

  const card = account.kind === "card";
  const parsed = parseAmount(text);
  const actual = parsed !== null && card ? -parsed : parsed;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (actual === null) return setError("Type the amount, like 1,250.00.");
    // The dollars are for the difference, which only the server knows; the form asks for them only
    // if there is no rate.
    const usd = typedUsd(typed, account.currency, actual - account.balance);
    if (usd === null) return setError("Type the US dollar amount of the difference, like 18.45.");
    setSaving(true);
    try {
      const body: BalanceCheck = { id, date, actual, ...(usd === undefined ? {} : { usd }) };
      const answer = await api<BalanceCheckResult>(`/api/accounts/${account.id}/check`, { method: "POST", body });
      setResult(answer);
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "no-rate") typed.setTyping(true);
      setError(describeError(err));
    }
    setSaving(false);
  }

  if (result) {
    return (
      <Dialog title="Check balance" onClose={onClose}>
        {result.entry ? (
          <p className="lead">
            Fafnir had a difference of <strong>{money(Math.abs(result.entry.amount), account.currency)}</strong>. It's
            recorded now, so {account.name} matches. It appears in your activity as a balance check.
          </p>
        ) : (
          <p className="lead">All good: {account.name} already matched.</p>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog title={`Check ${account.name}`} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        <p className="lead">
          Look at the balance your {card ? "card" : "bank or wallet"} shows. If it differs from what Fafnir has, the
          difference is recorded for you.
        </p>
        <div className="two">
          <label className="field">
            <span>{card ? "How much do you owe?" : "How much does it show?"}</span>
            <input
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field">
            <span>On what day?</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {typed.typing && (
          <Dollars
            currency={account.currency}
            cents={actual === null ? null : actual - account.balance}
            date={date}
            typed={typed}
          />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Checking…" : "Check"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

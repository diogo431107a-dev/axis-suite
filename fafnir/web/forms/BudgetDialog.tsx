import { useState, type FormEvent } from "react";
import type { BudgetChange, BudgetLine } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { parseAmount, plainAmount, showMonth } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";

/** Sets, changes or removes a spending category's monthly budget, from a month on. */
export function BudgetDialog({
  name,
  line,
  month,
  onClose,
  onSaved,
}: {
  name: string;
  line: BudgetLine;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { budget } = line;
  const [currency, setCurrency] = useState<"USD" | "BRL">(budget?.currency ?? "BRL");
  const [text, setText] = useState(budget ? plainAmount(budget.amount, budget.currency) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(text, currency);

  async function send(change: BudgetChange) {
    setError("");
    setSaving(true);
    try {
      await api(`/api/budgets/${line.category}`, { method: "PUT", body: change });
      onSaved();
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (amount === null || amount <= 0) return setError("Type the budget, like 1,500.00.");
    void send({ month, currency, amount });
  }

  return (
    <Dialog title={`Budget: ${name}`} onClose={onClose}>
      <form onSubmit={save} noValidate>
        <p className="lead">
          A monthly limit for {name}, from {showMonth(month)} on. Earlier months keep the budget they had.
        </p>
        <div className="two">
          <label className="field">
            <span>Each month</span>
            <AmountInput currency={currency} value={text} onChange={setText} />
          </label>
          <label className="field">
            <span>In</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "BRL")}>
              <option value="BRL">Brazilian reais (BRL)</option>
              <option value="USD">US dollars (USD)</option>
            </select>
          </label>
        </div>
        <p className="dollars muted">
          Spending in another currency counts at its day's rate, so a budget in reais stays in reais whatever the dollar
          does.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {budget && (
            <div className="delete-row">
              <button
                type="button"
                className="btn quiet"
                disabled={saving}
                onClick={() => void send({ month, currency: budget.currency, amount: null })}
              >
                No budget from {showMonth(month)}
              </button>
            </div>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

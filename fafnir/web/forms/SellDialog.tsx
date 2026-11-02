import { useState, type FormEvent } from "react";
import { hasOwnPage, type Book, type MoneyAccount, type Sale } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { localDate, money, parseAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { AmountInput } from "./AmountInput.tsx";

/** Selling something the user owns: what it sold for, and where the money went. */
export function SellDialog({
  book,
  asset,
  onClose,
  onSaved,
}: {
  book: Book;
  asset: MoneyAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currency } = asset;
  // Made once, so trying again after a refusal doesn't sell it twice.
  const [id] = useState(() => crypto.randomUUID());
  const [valueId] = useState(() => crypto.randomUUID());
  const accounts = book.accounts.filter((a) => !a.closed && !hasOwnPage(a.kind) && a.currency === currency);
  const [text, setText] = useState("");
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(localDate());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const price = parseAmount(text, currency);
  const difference = price === null ? null : price - asset.balance;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (price === null || price < 0)
      return setError("Type what it sold for, like 55,000.00, or 0 if it went for nothing.");
    if (!account) return setError("Pick the account the money went to.");
    if (!date) return setError("Pick a date.");
    setSaving(true);
    try {
      const body: Sale = { id, valueId, account, amount: price, date };
      await api(`/api/accounts/${asset.id}/sell`, { method: "POST", body });
      onSaved();
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title={`Sold: ${asset.name}`} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        {accounts.length === 0 && (
          <p className="form-error" role="alert">
            You have no {currency} account for the money. Add one first.
          </p>
        )}
        <label className="field">
          <span>What did it sell for?</span>
          <AmountInput currency={currency} value={text} onChange={setText} />
        </label>
        {difference !== null && (
          <p className="dollars">
            {difference === 0
              ? "That's its value, so nothing else changes."
              : `That's ${money(Math.abs(difference), currency)} ${difference > 0 ? "more" : "less"} than its value, which shows as a value change.`}{" "}
            Then it's moved to your sold things.
          </p>
        )}
        <div className="two">
          <label className="field">
            <span>Into</span>
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving || accounts.length === 0}>
            {saving ? "Saving…" : "Sell it"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

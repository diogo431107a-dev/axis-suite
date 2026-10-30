import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import {
  ENTRY_KINDS,
  type Account,
  type Book,
  type Entry,
  type EntryChange,
  type EntryKind,
  type MoneyAccount,
  type NewCategory,
  type NewEntry,
} from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { localDate, money, parseAmount, plainAmount, showDate } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Dollars } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

const KIND_LABELS: Record<EntryKind, string> = { spent: "Spent", received: "Received", moved: "Moved" };
const NEW_CATEGORY = "new";
const LAST_ACCOUNT_KEY = "fafnir.lastAccount";

// The account used last is the likely one next time. Only a convenience, so a browser that refuses
// storage just starts from the first account.
function lastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}
function rememberAccount(id: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Nothing is lost but the convenience.
  }
}

function AccountOptions({ accounts }: { accounts: MoneyAccount[] }) {
  return accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.group ? `${a.group}: ` : ""}
      {a.name} ({a.currency})
    </option>
  ));
}

/** Adds an entry or changes one. A balance check can only be deleted; a starting balance has fewer fields. */
export function EntryDialog({
  book,
  entry,
  onClose,
  onSaved,
}: {
  book: Book;
  entry?: Entry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const everyday = entry === undefined || (entry.kind !== "starting" && entry.kind !== "adjustment");
  const [id] = useState(() => crypto.randomUUID());
  const open = book.accounts.filter((a) => !a.closed || a.id === entry?.account || a.id === entry?.other);

  const [kind, setKind] = useState<EntryKind>(entry && everyday ? (entry.kind as EntryKind) : "spent");
  const [amountText, setAmountText] = useState(() => {
    if (!entry) return "";
    return `${entry.amount < 0 ? "-" : ""}${plainAmount(entry.amount)}`;
  });
  const [account, setAccount] = useState(() => {
    if (entry) return entry.account;
    const last = lastAccount();
    return open.find((a) => a.id === last)?.id ?? open[0]?.id ?? "";
  });
  const [other, setOther] = useState(entry?.other ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [date, setDate] = useState(entry?.date ?? localDate());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const from = book.accounts.find((a) => a.id === account);
  const cents = parseAmount(amountText);
  const categoryKind: Account["kind"] = kind === "spent" ? "expense" : "income";
  const categories = book.categories.filter((c) => c.kind === categoryKind && (!c.closed || c.id === entry?.other));
  const destinations = open.filter((a) => a.id !== account && a.currency === from?.currency);
  const creatingCategory = kind !== "moved" && other === NEW_CATEGORY;
  const unchanged = entry && cents === entry.amount && date === entry.date && from?.currency === entry.currency;

  const switchKind = (next: EntryKind) => {
    setKind(next);
    setOther("");
    setError("");
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (cents === null) return setError("Type the amount, like 25.90.");
    if (everyday && cents <= 0) return setError("The amount must be above zero.");
    if (!date) return setError("Pick a date.");
    if (everyday && !other) {
      return setError(kind === "moved" ? "Pick where the money went." : "Pick a category.");
    }
    if (creatingCategory && !newCategory.trim()) return setError("Give the new category a name.");
    const usd = typedUsd(typed, from?.currency, cents);
    if (usd === null) return setError("Type the US dollar amount, like 18.45.");

    setSaving(true);
    try {
      let target = other;
      if (creatingCategory) {
        const category: NewCategory = {
          id: crypto.randomUUID(),
          name: newCategory,
          kind: kind === "spent" ? "expense" : "income",
        };
        await api("/api/categories", { method: "POST", body: category });
        target = category.id;
        setOther(target);
      }
      const common = { date, memo, account, amount: cents, ...(usd === undefined ? {} : { usd }) };
      if (entry) {
        const change: EntryChange = everyday ? { ...common, kind, other: target } : { ...common, kind: "starting" };
        await api(`/api/entries/${entry.id}`, { method: "PUT", body: change });
      } else {
        const created: NewEntry = { ...common, id, kind, other: target };
        await api("/api/entries", { method: "POST", body: created });
        rememberAccount(account);
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

  const deleteControls = entry && (
    <div className="delete-row">
      {confirmDelete ? (
        <>
          <span>Delete this entry?</span>
          <button type="button" className="btn danger" disabled={saving} onClick={() => void remove()}>
            Delete
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" className="btn quiet" onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden /> Delete
        </button>
      )}
    </div>
  );

  // A balance check only says what the bank showed on a day: to redo one, delete it and check again.
  if (entry?.kind === "adjustment") {
    return (
      <Dialog title="Balance check" onClose={onClose}>
        <p className="lead">
          {from?.name} was {entry.amount > 0 ? "higher" : "lower"} than recorded by{" "}
          <strong>{money(Math.abs(entry.amount), entry.currency)}</strong>, so this difference was added on{" "}
          {showDate(entry.date)}.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {deleteControls}
      </Dialog>
    );
  }

  const title = entry ? (everyday ? "Change entry" : "Change starting balance") : "Add an entry";
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} noValidate>
        {everyday && (
          <div className="segmented" role="radiogroup" aria-label="What happened">
            {ENTRY_KINDS.map((k) => (
              <button
                type="button"
                role="radio"
                aria-checked={kind === k}
                key={k}
                className={kind === k ? "on" : ""}
                onClick={() => switchKind(k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>
            {everyday ? "How much?" : `Balance${from?.kind === "card" ? " (below zero for what you owe)" : ""}`}
          </span>
          <div className="amount-input">
            <span aria-hidden>{from?.currency === "BRL" ? "R$" : "$"}</span>
            <input
              inputMode="decimal"
              autoComplete="off"
              required
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </label>
        <Dollars
          currency={from?.currency}
          cents={cents}
          date={date}
          typed={typed}
          saved={unchanged ? entry.usd : undefined}
        />

        {everyday && (
          <label className="field">
            <span>{kind === "spent" ? "Paid from" : kind === "received" ? "Into" : "From"}</span>
            <select
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                if (kind === "moved") setOther("");
              }}
            >
              <AccountOptions accounts={open} />
            </select>
          </label>
        )}

        {everyday && kind === "moved" && (
          <label className="field">
            <span>To</span>
            <select value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Pick an account</option>
              <AccountOptions accounts={destinations} />
            </select>
            {destinations.length === 0 && (
              <small>
                You have no other {from?.currency} account. Moving money between currencies arrives in a later version.
              </small>
            )}
          </label>
        )}

        {everyday && kind !== "moved" && (
          <label className="field">
            <span>Category</span>
            <select value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Pick a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CATEGORY}>New category…</option>
            </select>
          </label>
        )}
        {creatingCategory && (
          <label className="field">
            <span>New category's name</span>
            <input value={newCategory} maxLength={100} onChange={(e) => setNewCategory(e.target.value)} />
          </label>
        )}

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
          {deleteControls}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : entry ? "Save changes" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

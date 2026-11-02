import { useState, type FormEvent } from "react";
import { COINS, CURRENCY_INFO, FIAT, isCoin } from "../../shared/currencies.ts";
import {
  MONEY_KINDS,
  hasOwnPage,
  type AccountChange,
  type Book,
  type Currency,
  type MoneyAccount,
  type MoneyKind,
  type NewAccount,
} from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { KIND_NAMES, localDate, parseAmount } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Dollars, ReadAs } from "./Dollars.tsx";
import { typedUsd, useTypedDollars } from "./typed.ts";

const KIND_HINTS: Record<MoneyKind, string> = {
  cash: "Money in your wallet.",
  bank: "An account you pay and get paid from.",
  savings: "Money you are setting aside.",
  card: "What you spend on it is money you owe until you pay the bill.",
  crypto: "Bitcoin, ICP or USDC, on an exchange or in a wallet of your own.",
  borrowed: "Money you have to pay back.",
  lent: "Money someone has to pay you back.",
  asset: "A car, a house or anything else you could sell, at a value you type.",
};

/** Adds an account, or changes, closes, reopens or deletes one. */
export function AccountDialog({
  book,
  account,
  startAs,
  onClose,
  onSaved,
}: {
  book: Book;
  account?: MoneyAccount;
  /** What a new account starts out as. */
  startAs?: MoneyKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<MoneyKind>(account?.kind ?? startAs ?? "bank");
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? (startAs === "crypto" ? "BTC" : "BRL"));
  const [group, setGroup] = useState(account?.group ?? "");
  const [startingText, setStartingText] = useState("");
  const [date, setDate] = useState(localDate());
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const groups = [...new Set(book.accounts.map((a) => a.group).filter(Boolean))];
  const parsed = startingText.trim() === "" ? 0 : parseAmount(startingText, currency);
  // On a card the question is what is owed, so the number typed is the debt.
  const starting = parsed !== null && kind === "card" ? -parsed : parsed;
  const holdsCoin = kind === "crypto";
  // A coin's account can't turn into a bank account, or the other way round: what it holds would stop fitting.
  const kinds = MONEY_KINDS.filter(
    (k) => !hasOwnPage(k) && (!account || (k === "crypto") === isCoin(account.currency)),
  );
  // A loan or something you own keeps its kind, so its field goes.
  const ownPage = hasOwnPage(kind);
  const what = kind === "asset" ? "it" : ownPage ? "loan" : "account";

  const changeKind = (next: MoneyKind) => {
    setKind(next);
    if ((next === "crypto") !== isCoin(currency)) setCurrency(next === "crypto" ? "BTC" : "BRL");
  };

  async function run(work: () => Promise<unknown>) {
    setError("");
    setSaving(true);
    try {
      await work();
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "no-rate") typed.setTyping(true);
      setError(describeError(err));
      setSaving(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name, like the bank's.");
    if (account) {
      const change: AccountChange = { name, kind, group };
      return void run(() => api(`/api/accounts/${account.id}`, { method: "PATCH", body: change }));
    }
    if (starting === null) return setError("Type the amount, like 1,250.00.");
    const usd = typedUsd(typed, currency, starting);
    if (usd === null) return setError("Type the US dollar amount, like 18.45.");
    const created: NewAccount = {
      id,
      name,
      kind,
      currency,
      group,
      ...(starting === 0 ? {} : { starting, date, ...(usd === undefined ? {} : { usd }) }),
    };
    void run(() => api("/api/accounts", { method: "POST", body: created }));
  }

  return (
    <Dialog
      title={kind === "asset" ? "Change" : ownPage ? "Change loan" : account ? "Change account" : "Add an account"}
      onClose={onClose}
    >
      <form onSubmit={save} noValidate>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder={holdsCoin ? "Coinbase BTC, Staked ICP…" : "Itaú, Wallet, Nubank…"}
          />
        </label>

        {!ownPage && (
          <label className="field">
            <span>What is it?</span>
            <select value={kind} onChange={(e) => changeKind(e.target.value as MoneyKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_NAMES[k]}
                </option>
              ))}
            </select>
            <small>{KIND_HINTS[kind]}</small>
          </label>
        )}

        {!account && (
          <label className="field">
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {(holdsCoin ? COINS : FIAT).map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_INFO[c].name} ({c})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Group (optional)</span>
          <input
            list="fafnir-groups"
            value={group}
            maxLength={100}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Keeps accounts together, like Coinbase"
          />
          <datalist id="fafnir-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>

        {!account && (
          <>
            <div className="two">
              <label className="field">
                <span>
                  {kind === "card"
                    ? "How much do you owe on it?"
                    : holdsCoin
                      ? "How much do you hold?"
                      : "How much is in it?"}
                </span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={startingText}
                  onChange={(e) => setStartingText(e.target.value)}
                  placeholder="0.00"
                />
                <ReadAs text={startingText} currency={currency} />
              </label>
              <label className="field">
                <span>On what day?</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            {starting !== 0 && (
              <Dollars currency={currency} amount={starting} date={date} typed={typed} asCost={holdsCoin} />
            )}
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {account && (
            <div className="delete-row">
              {account.entries === 0 ? (
                <button
                  type="button"
                  className="btn quiet"
                  disabled={saving}
                  onClick={() => void run(() => api(`/api/accounts/${account.id}`, { method: "DELETE" }))}
                >
                  Delete {what}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn quiet"
                  disabled={saving}
                  title={account.closed ? "" : "Only an account with nothing in it can be closed"}
                  onClick={() =>
                    void run(() =>
                      api(`/api/accounts/${account.id}`, {
                        method: "PATCH",
                        body: { closed: !account.closed } satisfies AccountChange,
                      }),
                    )
                  }
                >
                  {account.closed ? "Reopen" : "Close"} {what}
                </button>
              )}
            </div>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : account ? "Save changes" : "Add account"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

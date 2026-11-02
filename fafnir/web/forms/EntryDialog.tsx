import { useState, type FormEvent } from "react";
import { isCoin, unitOf } from "../../shared/currencies.ts";
import {
  ENTRY_KINDS,
  hasOwnPage,
  type Account,
  type Book,
  type Currency,
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
import { AmountInput } from "./AmountInput.tsx";
import { DeleteEntry } from "./DeleteEntry.tsx";
import { Dollars, ReadAs } from "./Dollars.tsx";
import { convert, typedUsd, useRates, useTypedDollars, type DayRates } from "./typed.ts";

const KIND_LABELS: Record<EntryKind, string> = {
  spent: "Spent",
  received: "Received",
  moved: "Moved",
  exchanged: "Exchanged",
};
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
      {a.group && !a.name.startsWith(a.group) ? `${a.group}: ` : ""}
      {a.name}
      {a.name.includes(a.currency) ? "" : ` (${a.currency})`}
    </option>
  ));
}

/** Which of two currencies a rate is the price of: the one worth more. */
const PRICIER: Currency[] = ["BTC", "ICP", "USDC", "USD", "BRL"];

/** The rate that two amounts come to, next to the day's, so a bad exchange shows. */
function RateNote({
  first,
  second,
  rates,
}: {
  first: { currency: Currency | undefined; amount: number | null };
  second: { currency: Currency | undefined; amount: number | null };
  rates: DayRates | null;
}) {
  if (!first.currency || !second.currency || !first.amount || !second.amount) return null;
  if (first.amount <= 0 || second.amount <= 0 || first.currency === second.currency) return null;
  const firstIsBase = PRICIER.indexOf(first.currency) < PRICIER.indexOf(second.currency);
  const [base, quote] = firstIsBase ? [first, second] : [second, first];
  const baseCurrency = base.currency!;
  const quoteCurrency = quote.currency!;
  const unit = unitOf(baseCurrency);
  const brlPerDollar = baseCurrency === "USD" && quoteCurrency === "BRL";
  // Reais per dollar reads to four places, like the rate it is compared with.
  const show = (perBase: number) =>
    brlPerDollar ? `R$ ${(perBase / 100).toFixed(4)}` : money(Math.round(perBase), quoteCurrency);
  const reference = brlPerDollar
    ? rates?.BRL
      ? rates.BRL.value * 100
      : null
    : convert(unit, baseCurrency, quoteCurrency, rates);
  return (
    <p className="dollars muted">
      That comes to {show((quote.amount! / base.amount!) * unit)} per {brlPerDollar ? "dollar" : baseCurrency}
      {reference !== null && `. The day's reference is ${show(reference)}`}.
    </p>
  );
}

/** What to suggest for an amount in another currency: empty until there's something to go on. */
function shownOrEmpty(
  amount: number | null,
  from: Currency | undefined,
  to: Currency | undefined,
  rates: DayRates | null,
): string {
  if (!amount || amount <= 0 || !from || !to) return "";
  const converted = convert(amount, from, to, rates);
  return converted === null ? "" : plainAmount(converted, to);
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
  // Loans and things you own have their own forms, so one is only here if this entry already uses it.
  const open = book.accounts.filter(
    (a) => (!a.closed && !hasOwnPage(a.kind)) || a.id === entry?.account || a.id === entry?.other,
  );

  const [kind, setKind] = useState<EntryKind>(entry && everyday ? (entry.kind as EntryKind) : "spent");
  const [amountText, setAmountText] = useState(() => {
    if (!entry) return "";
    return `${entry.amount < 0 ? "-" : ""}${plainAmount(entry.amount, entry.currency)}`;
  });
  // An amount worked out from the rate follows the other one until the user types over it.
  const [amountTyped, setAmountTyped] = useState(entry !== undefined);
  const [account, setAccount] = useState(() => {
    if (entry) return entry.account;
    const last = lastAccount();
    return open.find((a) => a.id === last)?.id ?? open[0]?.id ?? "";
  });
  const [other, setOther] = useState(entry?.other ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [foreign, setForeign] = useState(Boolean(entry?.paid));
  const [paidText, setPaidText] = useState(entry?.paid ? plainAmount(entry.paid.amount, entry.paid.currency) : "");
  const [arrivedText, setArrivedText] = useState(
    entry?.arrived ? plainAmount(entry.arrived.amount, entry.arrived.currency) : "",
  );
  const [hasFee, setHasFee] = useState(Boolean(entry?.fee));
  const [feeText, setFeeText] = useState(entry?.fee ? plainAmount(entry.fee.amount, entry.fee.currency) : "");
  const [arrivedTyped, setArrivedTyped] = useState(Boolean(entry?.arrived));
  const [date, setDate] = useState(entry?.date ?? localDate());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const typed = useTypedDollars();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const from = book.accounts.find((a) => a.id === account);
  const to = book.accounts.find((a) => a.id === other);
  const exchanging = kind === "exchanged";
  const takesCategory = everyday && (kind === "spent" || kind === "received");
  const takesFee = everyday && (kind === "moved" || kind === "exchanged");
  // A price in the other currency is for reais and dollars. Paying with a coin is an exchange.
  const canBeForeign = takesCategory && from !== undefined && !isCoin(from.currency);
  const inForeign = foreign && canBeForeign;
  const foreignCurrency: Currency = from?.currency === "USD" ? "BRL" : "USD";
  const { rates } = useRates(date, everyday && (exchanging || inForeign));

  const paid = inForeign ? parseAmount(paidText, foreignCurrency) : null;
  // Charged to the account: follows the price at the day's rate until typed over.
  const amountShown =
    inForeign && !amountTyped ? shownOrEmpty(paid, foreignCurrency, from?.currency, rates) : amountText;
  const amount = parseAmount(amountShown, from?.currency);
  const fee = takesFee && hasFee && feeText.trim() !== "" ? parseAmount(feeText, from?.currency) : 0;
  // What is left of the amount once the fee has come out of it.
  const net = amount !== null && fee !== null ? amount - fee : null;
  // What arrived: follows what left at the day's rate until typed over.
  const arrivedShown =
    exchanging && !arrivedTyped ? shownOrEmpty(net, from?.currency, to?.currency, rates) : arrivedText;
  const arrived = exchanging ? parseAmount(arrivedShown, to?.currency) : null;

  const categoryKind: Account["kind"] = kind === "spent" ? "expense" : "income";
  const categories = book.categories.filter((c) => c.kind === categoryKind && (!c.closed || c.id === entry?.other));
  const destinations = open.filter(
    (a) => a.id !== account && (exchanging ? a.currency !== from?.currency : a.currency === from?.currency),
  );
  const creatingCategory = takesCategory && other === NEW_CATEGORY;
  const unchanged =
    entry &&
    !entry.paid &&
    !inForeign &&
    amount === entry.amount &&
    fee === (entry.fee?.amount ?? 0) &&
    date === entry.date &&
    from?.currency === entry.currency;

  const switchKind = (next: EntryKind) => {
    setKind(next);
    setOther("");
    setForeign(false);
    setError("");
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (inForeign && (paid === null || paid <= 0)) return setError("Type the price, like 19.99.");
    if (amount === null) return setError("Type the amount, like 25.90.");
    if (everyday && amount <= 0) return setError("The amount must be above zero.");
    if (fee === null || fee < 0) return setError("Type the fee, like 0.50.");
    if (fee >= amount && fee > 0) return setError("The fee has to be part of the amount, and less than all of it.");
    if (!date) return setError("Pick a date.");
    if (everyday && !other) {
      return setError(takesCategory ? "Pick a category." : "Pick where the money went.");
    }
    if (exchanging && (arrived === null || arrived <= 0)) return setError("Type how much arrived, like 180.00.");
    if (creatingCategory && !newCategory.trim()) return setError("Give the new category a name.");
    // An exchange only asks for the dollars when the price of what values it isn't known.
    const usd = inForeign
      ? undefined
      : exchanging
        ? typedUsd(typed, from?.currency === "USD" ? to?.currency : from?.currency, 1)
        : typedUsd(typed, from?.currency, amount);
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
      const common = {
        date,
        memo,
        account,
        amount,
        ...(usd === undefined ? {} : { usd }),
        ...(fee > 0 ? { fee } : {}),
        ...(inForeign && paid !== null ? { paid: { currency: foreignCurrency, amount: paid } } : {}),
        ...(exchanging && arrived !== null ? { arrived } : {}),
      };
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

  const deleteControls = entry && <DeleteEntry disabled={saving} onDelete={() => void remove()} />;

  // A balance check only says what the bank showed on a day: to redo one, delete it and check again.
  if (entry?.kind === "adjustment" || entry?.kind === "revalued") {
    const revalued = entry.kind === "revalued";
    return (
      <Dialog title={revalued ? "New value" : "Balance check"} onClose={onClose}>
        <p className="lead">
          {revalued
            ? `${from?.name ?? "It"} was given a value `
            : `${from?.name} was ${entry.amount > 0 ? "higher" : "lower"} than recorded `}
          {revalued ? (entry.amount > 0 ? "higher " : "lower ") : ""}
          by <strong>{money(Math.abs(entry.amount), entry.currency)}</strong> on {showDate(entry.date)}.{" "}
          {revalued ? "To change it, delete it and give a new value again." : ""}
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
  let amountLabel = "How much?";
  if (!everyday) {
    amountLabel = `Balance${from?.kind === "card" || from?.kind === "borrowed" ? " (below zero for what you owe)" : ""}`;
  } else if (kind === "moved" || exchanging) amountLabel = fee ? "How much left, with the fee?" : "How much left?";
  else if (inForeign) amountLabel = kind === "spent" ? `Charged to ${from?.name}` : `Reached ${from?.name}`;

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

        {inForeign && (
          <label className="field">
            <span>
              {kind === "spent" ? "The price" : "The amount"} in {foreignCurrency === "USD" ? "US dollars" : "reais"}
            </span>
            <AmountInput currency={foreignCurrency} value={paidText} onChange={setPaidText} />
          </label>
        )}

        <label className="field">
          <span>{amountLabel}</span>
          <AmountInput
            currency={from?.currency}
            value={amountShown}
            onChange={(text) => {
              setAmountText(text);
              setAmountTyped(true);
            }}
          />
          <ReadAs text={amountShown} currency={from?.currency} />
          {inForeign && !amountTyped && (
            <small>
              Worked out from the day's rate. Your {kind === "spent" ? "statement" : "bank"} may show a different
              amount: type it here if so.
            </small>
          )}
        </label>

        {inForeign
          ? amountTyped && (
              <RateNote
                first={{ currency: foreignCurrency, amount: paid }}
                second={{ currency: from?.currency, amount }}
                rates={rates}
              />
            )
          : !exchanging && (
              <Dollars
                currency={from?.currency}
                amount={amount}
                date={date}
                typed={typed}
                saved={unchanged ? entry.usd : undefined}
              />
            )}

        {exchanging && typed.typing && (
          <Dollars
            currency={from?.currency === "USD" ? to?.currency : from?.currency}
            amount={net}
            date={date}
            typed={typed}
          />
        )}

        {canBeForeign && (
          <button
            type="button"
            className="link foreign-toggle"
            onClick={() => {
              setForeign(!foreign);
              setAmountTyped(foreign);
            }}
          >
            {foreign
              ? "It wasn't in another currency"
              : `It was in ${foreignCurrency === "USD" ? "US dollars" : "reais"}`}
          </button>
        )}

        {everyday && (
          <label className="field">
            <span>{kind === "spent" ? "Paid from" : kind === "received" ? "Into" : "From"}</span>
            <select
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                if (!takesCategory) setOther("");
              }}
            >
              <AccountOptions accounts={open} />
            </select>
          </label>
        )}

        {takesFee && (
          <>
            {hasFee ? (
              <label className="field">
                <span>The fee, in {from?.currency} (part of what left)</span>
                <AmountInput currency={from?.currency} value={feeText} onChange={setFeeText} />
                <ReadAs text={feeText} currency={from?.currency} />
                {kind === "moved" && net !== null && net > 0 && from && (
                  <small>{money(net, from.currency)} arrives. The fee goes to your spending, under Fees.</small>
                )}
                {exchanging && <small>The fee goes to your spending, under Fees.</small>}
              </label>
            ) : (
              <button type="button" className="link foreign-toggle" onClick={() => setHasFee(true)}>
                There was a fee
              </button>
            )}
          </>
        )}

        {everyday && !takesCategory && (
          <label className="field">
            <span>To</span>
            <select value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Pick an account</option>
              <AccountOptions accounts={destinations} />
            </select>
            {destinations.length === 0 && (
              <small>
                {exchanging
                  ? "You have no account in another currency yet. Add one in Accounts."
                  : `You have no other ${from?.currency} account. To change money into another currency, use Exchanged.`}
              </small>
            )}
          </label>
        )}

        {exchanging && (
          <>
            <label className="field">
              <span>How much arrived?</span>
              <AmountInput
                currency={to?.currency}
                value={arrivedShown}
                onChange={(text) => {
                  setArrivedText(text);
                  setArrivedTyped(true);
                }}
              />
              <ReadAs text={arrivedShown} currency={to?.currency} />
              {!arrivedTyped && (
                <small>Worked out from the day's rate. Type what actually arrived if it differs.</small>
              )}
            </label>
            {arrivedTyped && (
              <RateNote
                first={{ currency: from?.currency, amount: net }}
                second={{ currency: to?.currency, amount: arrived }}
                rates={rates}
              />
            )}
          </>
        )}

        {takesCategory && (
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

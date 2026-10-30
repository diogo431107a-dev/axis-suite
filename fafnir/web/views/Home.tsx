import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import type { Book, MoneyAccount } from "../../shared/protocol.ts";
import { addMonths, localDate, money, showDate, showMonth } from "../format.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A rate this old means the sources have been failing, not just a weekend or a holiday. */
const STALE_DAYS = 5;

const signedMoney = (cents: number) => `${cents > 0 ? "+" : ""}${money(cents)}`;

/** A card's negative balance reads as what is owed; everything else as a plain balance. */
export function BalanceText({ account }: { account: MoneyAccount }) {
  const owed = account.kind === "card" && account.balance < 0;
  return (
    <span className="amount">
      {owed && <small>you owe </small>}
      {money(owed ? -account.balance : account.balance, account.currency)}
    </span>
  );
}

export function AccountRows({ accounts, onOpen }: { accounts: MoneyAccount[]; onOpen: (a: MoneyAccount) => void }) {
  const groups = new Map<string, MoneyAccount[]>();
  for (const a of accounts) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
  return [...groups].map(([group, rows]) => (
    <section key={group} className="account-group">
      {group && <h3>{group}</h3>}
      <ul className="rows">
        {rows.map((a) => (
          <li key={a.id}>
            <button type="button" className="row" onClick={() => onOpen(a)}>
              <span className="row-main">{a.name}</span>
              <span className="row-end">
                <BalanceText account={a} />
                {a.currency !== "USD" && (
                  <small className="muted">
                    {a.usdNow === null
                      ? "no rate yet"
                      : `≈ ${money(a.kind === "card" ? Math.abs(a.usdNow) : a.usdNow)}`}
                  </small>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  ));
}

export function Home({
  book,
  month,
  onMonth,
  onAddAccount,
  onOpenAccount,
}: {
  book: Book;
  month: string;
  onMonth: (month: string) => void;
  onAddAccount: () => void;
  onOpenAccount: (account: MoneyAccount) => void;
}) {
  const accounts = book.accounts.filter((a) => !a.closed);
  const names = new Map(book.categories.map((c) => [c.id, c.name]));
  const { moneyIn, moneyOut, spending, change } = book.month;
  const biggest = spending[0]?.usd ?? 1;
  const thisMonth = localDate().slice(0, 7);
  const rateAge = book.rate ? (Date.parse(localDate()) - Date.parse(book.rate.date)) / DAY_MS : 0;

  if (book.accounts.length === 0) {
    return (
      <div className="welcome">
        <h1>Welcome to Fafnir</h1>
        <p>
          Fafnir keeps track of what you have, what you owe and where your money goes. You can write amounts in reais or
          dollars, and it shows everything added up in US dollars.
        </p>
        <p>Start with one account: your bank, your wallet or a credit card.</p>
        <button type="button" className="btn primary" onClick={onAddAccount}>
          Add your first account
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="worth">
        <p className="label">What I'm worth</p>
        <p className="worth-number">{money(book.have - book.owe)}</p>
        <dl className="worth-parts">
          <div>
            <dt>What I have</dt>
            <dd>{money(book.have)}</dd>
          </div>
          <div>
            <dt>What I owe</dt>
            <dd>{money(book.owe)}</dd>
          </div>
        </dl>
        {book.missingRate && (
          <p className="notice" role="status">
            <CircleAlert aria-hidden /> No exchange rate is available yet, so your reais aren't counted in these totals.
          </p>
        )}
        {book.rate && rateAge > STALE_DAYS && (
          <p className="notice" role="status">
            <CircleAlert aria-hidden /> The latest exchange rate is from {showDate(book.rate.date)}. Fafnir couldn't get
            a newer one.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{showMonth(month)}</h2>
          <div className="month-nav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => onMonth(addMonths(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={month >= thisMonth}
              onClick={() => onMonth(addMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight aria-hidden />
            </button>
          </div>
        </div>
        <dl className="month-numbers">
          <div>
            <dt>Money in</dt>
            <dd className="pos">{money(moneyIn)}</dd>
          </div>
          <div>
            <dt>Money out</dt>
            <dd>{money(moneyOut)}</dd>
          </div>
          <div>
            <dt>Left over</dt>
            <dd>{money(moneyIn - moneyOut)}</dd>
          </div>
        </dl>
        {change && (change.start !== 0 || change.end !== 0) && (
          <>
            <h3>What you're worth, start to end</h3>
            <dl className="change">
              <div>
                <dt>At the start</dt>
                <dd>{money(change.start)}</dd>
              </div>
              <div>
                <dt>Money in, less money out</dt>
                <dd>{signedMoney(moneyIn - moneyOut)}</dd>
              </div>
              {change.added !== 0 && (
                <div>
                  <dt>Starting balances and balance checks</dt>
                  <dd>{signedMoney(change.added)}</dd>
                </div>
              )}
              {change.rates !== 0 && (
                <div>
                  <dt>
                    Exchange rate changes
                    <small>Your reais worth more or fewer dollars, and what exchanging cost.</small>
                  </dt>
                  <dd>{signedMoney(change.rates)}</dd>
                </div>
              )}
              <div className="change-end">
                <dt>{month === thisMonth ? "Now" : "At the end"}</dt>
                <dd>{money(change.end)}</dd>
              </div>
            </dl>
          </>
        )}
        {spending.length > 0 && (
          <>
            <h3>Where it went</h3>
            <ul className="bars">
              {spending.map((s) => (
                <li key={s.category}>
                  <span>{names.get(s.category)}</span>
                  <span className="bar" aria-hidden>
                    <span style={{ width: `${Math.max(2, (s.usd / biggest) * 100)}%` }} />
                  </span>
                  <span className="amount">{money(s.usd)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Accounts</h2>
        </div>
        <AccountRows accounts={accounts} onOpen={onOpenAccount} />
        {book.rate && (
          <p className="footnote">
            US$ 1 = R$ {book.rate.value.toFixed(4)} ({book.rate.source}, {showDate(book.rate.date)}). This is a
            reference rate: your bank or card may charge a little more.
          </p>
        )}
      </section>
    </>
  );
}

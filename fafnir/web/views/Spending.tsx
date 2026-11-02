import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import type { Book, BudgetLine, Budgets, SpendingMonths } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { addMonths, localDate, money, showMonth } from "../format.ts";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole dollars, for a table where cents would only crowd it. */
const wholeDollars = (cents: number) =>
  cents === 0 ? "—" : `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

function BudgetRow({ name, line, onSet }: { name: string; line: BudgetLine; onSet: () => void }) {
  const { budget, spent, spentUsd, missingRate } = line;
  if (!budget) {
    return (
      <li className="budget-row">
        <div className="budget-top">
          <span>{name}</span>
          <span className="amount">{money(spentUsd)}</span>
        </div>
        <button type="button" className="link budget-set" onClick={onSet}>
          Set a budget
        </button>
      </li>
    );
  }
  const share = spent / budget.amount;
  const over = spent > budget.amount;
  return (
    <li className="budget-row">
      <div className="budget-top">
        <button type="button" className="link plain" onClick={onSet}>
          {name}
        </button>
        <span className="amount">
          {money(spent, budget.currency)} <small className="muted">of {money(budget.amount, budget.currency)}</small>
        </span>
      </div>
      <span className={`meter ${over ? "over" : ""}`} aria-hidden>
        <span style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
      <small className={over ? "over-text" : "muted"}>
        {over ? (
          <>
            <TriangleAlert aria-hidden className="inline-icon" /> Over by{" "}
            {money(spent - budget.amount, budget.currency)}
          </>
        ) : (
          `${money(budget.amount - spent, budget.currency)} left`
        )}
        {missingRate && " · some spending isn't counted for want of a rate"}
      </small>
    </li>
  );
}

/** A month's spending against its budgets, and the last twelve months side by side. */
export function Spending({
  book,
  version,
  onBudget,
}: {
  book: Book;
  /** Raised when something is saved, so the figures load again. */
  version: number;
  onBudget: (line: BudgetLine, month: string, name: string) => void;
}) {
  const thisMonth = localDate().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [budgets, setBudgets] = useState<Budgets | null>(null);
  const [months, setMonths] = useState<SpendingMonths | null>(null);
  const [error, setError] = useState("");
  const names = new Map(book.categories.map((c) => [c.id, c.name]));

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Budgets>(`/api/budgets?month=${month}`), api<SpendingMonths>(`/api/spending?month=${month}`)])
      .then(([b, m]) => {
        if (cancelled) return;
        setBudgets(b);
        setMonths(m);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [month, version]);

  const budgeted = budgets?.lines.filter((l) => l.budget) ?? [];
  const others = (budgets?.lines.filter((l) => !l.budget) ?? []).sort((a, b) => b.spentUsd - a.spentUsd);
  const name = (l: BudgetLine) => names.get(l.category) ?? "";

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h1>{showMonth(month)}</h1>
          <div className="month-nav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth(addMonths(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={month >= thisMonth}
              onClick={() => setMonth(addMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight aria-hidden />
            </button>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {budgets && (
          <>
            {budgeted.length > 0 ? (
              <>
                <h3>Budgets</h3>
                <ul className="budgets">
                  {budgeted.map((l) => (
                    <BudgetRow key={l.category} name={name(l)} line={l} onSet={() => onBudget(l, month, name(l))} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">
                A budget is a monthly limit for a category, in reais or dollars. Pick a category below to set one.
              </p>
            )}
            <h3>{budgeted.length > 0 ? "Without a budget" : "Spending"}</h3>
            <ul className="budgets">
              {others.map((l) => (
                <BudgetRow key={l.category} name={name(l)} line={l} onSet={() => onBudget(l, month, name(l))} />
              ))}
            </ul>
          </>
        )}
      </section>

      {months && (
        <section className="panel">
          <div className="panel-head">
            <h2>The last 12 months</h2>
          </div>
          {months.categories.length === 0 ? (
            <p className="empty">No spending in these months.</p>
          ) : (
            <div className="table-scroll">
              <table className="months-table">
                <thead>
                  <tr>
                    <th scope="col">In US dollars</th>
                    {months.months.map((m) => (
                      <th key={m} scope="col">
                        {SHORT[Number(m.slice(5)) - 1]}
                        {m.endsWith("-01") ? ` ${m.slice(2, 4)}` : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.categories.map((c) => (
                    <tr key={c.category}>
                      <th scope="row">{names.get(c.category)}</th>
                      {c.usd.map((v, i) => (
                        <td key={months.months[i]}>{wholeDollars(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Money out</th>
                    {months.moneyOut.map((v, i) => (
                      <td key={months.months[i]}>{wholeDollars(v)}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Money in</th>
                    {months.moneyIn.map((v, i) => (
                      <td key={months.months[i]}>{wholeDollars(v)}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="footnote">
            <CircleAlert aria-hidden className="inline-icon" /> Each entry counts at the dollars it was saved with, as
            on Home.
          </p>
        </section>
      )}
    </>
  );
}

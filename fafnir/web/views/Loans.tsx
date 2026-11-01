import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, HandCoins, Plus } from "lucide-react";
import type { LoanKind, LoanSummary, Loans as LoansData } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { money, showDate } from "../format.ts";

export interface LoanActions {
  onPayment: (loan: LoanSummary) => void;
  onInterest: (loan: LoanSummary) => void;
  onCheck: (loan: LoanSummary) => void;
  onActivity: (loan: LoanSummary) => void;
  onEdit: (loan: LoanSummary) => void;
}

function LoanCard({ loan, actions }: { loan: LoanSummary; actions: LoanActions }) {
  const { currency, left, paidOff, taken, interest, overpaid, lastPayment, usdLeft, closed } = loan;
  const borrowed = loan.kind === "borrowed";
  // Measured against what's been paid and what's left, so interest added later keeps the bar honest.
  const whole = paidOff + left;
  const share = whole > 0 ? Math.min(100, (paidOff / whole) * 100) : 0;
  return (
    <li className="account-card loan">
      <div className="account-card-top">
        <div>
          <p className="account-name">{loan.name}</p>
          <small className="muted">{lastPayment ? `Last payment ${showDate(lastPayment)}` : "No payments yet"}</small>
        </div>
        <div className="row-end">
          <span className="coin-value amount">{money(left, currency)}</span>
          <small className="muted">{left === 0 ? "nothing left" : borrowed ? "left to pay" : "left to get back"}</small>
          {currency !== "USD" && usdLeft !== null && left > 0 && <small className="muted">≈ {money(usdLeft)}</small>}
        </div>
      </div>
      {whole > 0 && (
        <span className="bar loan-bar" aria-hidden>
          <span style={{ width: `${share}%` }} />
        </span>
      )}
      <dl className="coin-figures">
        <div>
          <dt>{borrowed ? "Borrowed" : "Lent"}</dt>
          <dd>{money(taken, currency)}</dd>
        </div>
        <div>
          <dt>Paid off so far</dt>
          <dd>{money(paidOff, currency)}</dd>
        </div>
        <div>
          <dt>Interest so far</dt>
          <dd>{money(interest, currency)}</dd>
        </div>
      </dl>
      {overpaid > 0 && (
        <p className="notice" role="status">
          <CircleAlert aria-hidden /> {money(overpaid, currency)} has been paid beyond the whole loan. Is an entry
          wrong?
        </p>
      )}
      <div className="account-card-actions">
        {!closed && (
          <>
            <button type="button" className="btn" onClick={() => actions.onPayment(loan)}>
              Record a payment
            </button>
            <button type="button" className="btn" onClick={() => actions.onInterest(loan)}>
              Add interest
            </button>
            <button type="button" className="btn" onClick={() => actions.onCheck(loan)}>
              Check balance
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={() => actions.onActivity(loan)}>
          Activity
        </button>
        <button type="button" className="btn" onClick={() => actions.onEdit(loan)}>
          Change
        </button>
      </div>
    </li>
  );
}

const TITLES: Record<LoanKind, string> = { borrowed: "What I owe", lent: "Owed to me" };

/** Money the user owes and is owed: what's left, what has come off it, and what interest has been. */
export function Loans({
  version,
  onAdd,
  actions,
}: {
  /** Raised when something is saved, so the figures load again. */
  version: number;
  onAdd: () => void;
  actions: LoanActions;
}) {
  const [data, setData] = useState<LoansData | null>(null);
  const [error, setError] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<LoansData>("/api/loans")
      .then((answer) => {
        if (cancelled) return;
        setData(answer);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const failure = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );
  if (!data) return failure || null;

  if (data.loans.length === 0) {
    return (
      <div className="welcome">
        <h1>
          <HandCoins aria-hidden className="heading-icon" /> Your loans
        </h1>
        <p>
          Keep track of money you've borrowed and money you've lent: what's left, what you've paid off, and what the
          interest has come to.
        </p>
        <p>Borrowing doesn't change what you're worth, since you have the money and you owe it. Interest does.</p>
        {failure}
        <button type="button" className="btn primary" onClick={onAdd}>
          Add a loan
        </button>
      </div>
    );
  }

  const open = data.loans.filter((l) => !l.closed);
  const closed = data.loans.filter((l) => l.closed);
  const total = (kind: LoanKind) => open.filter((l) => l.kind === kind).reduce((sum, l) => sum + (l.usdLeft ?? 0), 0);
  const unknown = open.some((l) => l.usdLeft === null);

  return (
    <>
      {failure}
      <section className="panel">
        <div className="panel-head">
          <h1>Loans</h1>
          <button type="button" className="btn" onClick={onAdd}>
            <Plus aria-hidden /> Add a loan
          </button>
        </div>
        {unknown && (
          <p className="notice" role="status">
            <CircleAlert aria-hidden /> A rate isn't available yet, so some loans aren't counted in the totals below.
          </p>
        )}
        {(["borrowed", "lent"] as const).map((kind) => {
          const loans = open.filter((l) => l.kind === kind);
          if (loans.length === 0) return null;
          return (
            <section key={kind} className="account-group">
              <div className="loan-section">
                <h2>{TITLES[kind]}</h2>
                <span className="amount">{money(total(kind))}</span>
              </div>
              <ul className="account-cards">
                {loans.map((l) => (
                  <LoanCard key={l.id} loan={l} actions={actions} />
                ))}
              </ul>
            </section>
          );
        })}
        {closed.length > 0 && (
          <section className="account-group">
            <button type="button" className="link disclosure" onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              Closed loans ({closed.length})
            </button>
            {showClosed && (
              <ul className="account-cards">
                {closed.map((l) => (
                  <LoanCard key={l.id} loan={l} actions={actions} />
                ))}
              </ul>
            )}
          </section>
        )}
        <p className="footnote">
          Interest is what you type: Fafnir doesn't work it out. To close a loan, pay it down to zero, then Change it.
        </p>
      </section>
    </>
  );
}

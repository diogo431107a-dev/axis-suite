import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { WORTH_PARTS, type Book, type Currency, type WorthHistory, type WorthPart } from "../../shared/protocol.ts";
import { CURRENCIES, CURRENCY_INFO } from "../../shared/currencies.ts";
import { api, describeError } from "../api.ts";
import { PART_NAMES, money, showMonth } from "../format.ts";
import { WorthChart } from "./WorthChart.tsx";

/** Which part of what the user is worth an account's balance belongs to; the server's rule, kept in step. */
function partOf(kind: string, usd: number): WorthPart {
  if (usd < 0) return "debts";
  if (kind === "crypto") return "crypto";
  if (kind === "asset") return "owned";
  if (kind === "lent") return "lent";
  return "money";
}

function ShareBars({ rows, of }: { rows: { key: string; label: string; usd: number; swatch?: string }[]; of: number }) {
  return (
    <ul className="bars shares">
      {rows.map((r) => {
        const share = of > 0 ? (r.usd / of) * 100 : 0;
        return (
          <li key={r.key}>
            <span>
              {r.swatch && <span className={`key-box ${r.swatch}`} aria-hidden />}
              {r.label}
            </span>
            <span className="bar" aria-hidden>
              <span style={{ width: `${Math.max(1, share)}%` }} />
            </span>
            <span className="amount">
              {money(r.usd)} <small className="muted">{share.toFixed(share < 10 ? 1 : 0)}%</small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What the user is worth over time, and where it sits today. */
export function Worth({ book, version }: { book: Book; version: number }) {
  const [history, setHistory] = useState<WorthHistory | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<WorthHistory>("/api/worth")
      .then((answer) => {
        if (!cancelled) setHistory(answer);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Today, from the balances the page already has.
  const parts: Record<WorthPart, number> = { money: 0, crypto: 0, owned: 0, lent: 0, debts: 0 };
  const byCurrency = new Map<Currency, number>();
  for (const a of book.accounts) {
    if (a.usdNow === null || a.usdNow === 0) continue;
    parts[partOf(a.kind, a.usdNow)] += a.usdNow;
    if (a.usdNow > 0) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.usdNow);
  }
  const have = book.have;

  const points = history?.points ?? [];
  const known = points.filter((p) => p.total !== null);
  const latest = known.at(-1);
  // Against a year ago, or the first month there is if that's sooner.
  const cutoff = points.at(-13)?.month ?? "";
  const yearAgo = known.find((p) => p.month >= cutoff) ?? known[0];

  return (
    <>
      <section className="worth">
        <p className="label">What I'm worth</p>
        <p className="worth-number">{money(have - book.owe)}</p>
        {latest && yearAgo && yearAgo !== latest && (
          <p className="muted">
            {latest.total! >= yearAgo.total! ? "Up" : "Down"} {money(Math.abs(latest.total! - yearAgo.total!))} since
            the end of {showMonth(yearAgo.month)}.
          </p>
        )}
        {book.missingRate && (
          <p className="notice" role="status">
            <CircleAlert aria-hidden /> Some rates or prices aren't available yet, so those balances aren't counted.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h1>Over time</h1>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {history && points.length === 0 && <p className="empty">Nothing to show yet: add your first entry.</p>}
        {points.length > 0 && <WorthChart points={points} />}
        {points.some((p) => p.total === null) && (
          <p className="footnote">A month left blank is one whose rates aren't available, so Fafnir doesn't guess.</p>
        )}
        {points.length > 0 && (
          <details className="table-view">
            <summary>See it as a table</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    {WORTH_PARTS.map((k) => (
                      <th key={k} scope="col">
                        {PART_NAMES[k]}
                      </th>
                    ))}
                    <th scope="col">Worth</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.month}>
                      <th scope="row">{showMonth(p.month)}</th>
                      {WORTH_PARTS.map((k) => (
                        <td key={k}>{p.parts ? money(p.parts[k]) : "—"}</td>
                      ))}
                      <td>
                        <strong>{p.total === null ? "—" : money(p.total)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Where it is now</h2>
        </div>
        {have === 0 ? (
          <p className="empty">Nothing yet.</p>
        ) : (
          <>
            <h3>By kind, as a share of what I have</h3>
            <ShareBars
              of={have}
              rows={WORTH_PARTS.filter((k) => k !== "debts" && parts[k] > 0).map((k) => ({
                key: k,
                label: PART_NAMES[k],
                usd: parts[k],
                swatch: `part-${k}`,
              }))}
            />
            <h3>By currency, as a share of what I have</h3>
            <ShareBars
              of={have}
              rows={CURRENCIES.filter((c) => (byCurrency.get(c) ?? 0) > 0)
                .map((c) => ({ key: c, label: `${CURRENCY_INFO[c].name} (${c})`, usd: byCurrency.get(c)! }))
                .sort((a, b) => b.usd - a.usd)}
            />
            {parts.debts < 0 && (
              <p className="debts-line">
                <span>
                  <span className="key-box part-debts" aria-hidden />
                  Debts, set against that
                </span>
                <span className="amount">{money(parts.debts)}</span>
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

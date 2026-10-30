import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { Book, Entry, EntryPage } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { money, showDate } from "../format.ts";

/** What an entry is called in the list. */
function title(entry: Entry, names: Map<string, string>) {
  const account = names.get(entry.account) ?? "";
  const other = entry.other ? (names.get(entry.other) ?? "") : "";
  switch (entry.kind) {
    case "moved":
    case "exchanged":
      return (
        <>
          {account} <ArrowRight aria-label="to" className="inline-icon" /> {other}
        </>
      );
    case "starting":
      return `Starting balance of ${account}`;
    case "adjustment":
      return `Balance check of ${account}`;
    default:
      return other;
  }
}

/** Money coming in shows as positive, going out as negative, and a move or exchange as neither. */
function signed(entry: Entry): number {
  return entry.kind === "spent" ? -entry.amount : entry.amount;
}

export function Activity({
  book,
  version,
  account,
  onAccount,
  onOpen,
}: {
  book: Book;
  /** Raised when something is saved, so the list loads again. */
  version: number;
  account: string;
  onAccount: (id: string) => void;
  onOpen: (entry: Entry) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<EntryPage | null>(null);
  const [error, setError] = useState("");

  const names = new Map([...book.accounts, ...book.categories].map((a) => [a.id, a.name]));

  // Searching waits for a pause in the typing.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({ offset: String(offset) });
      if (account) params.set("account", account);
      if (search) params.set("q", search);
      return api<EntryPage>(`/api/entries?${params}`);
    },
    [account, search],
  );

  useEffect(() => {
    let cancelled = false;
    load(0)
      .then((first) => {
        if (cancelled) return;
        setPage(first);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [load, version]);

  const more = () => {
    if (!page) return;
    load(page.entries.length)
      .then((next) => setPage({ total: next.total, entries: [...page.entries, ...next.entries] }))
      .catch((err: unknown) => setError(describeError(err)));
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Activity</h1>
      </div>
      <div className="filters">
        <label className="search">
          <Search aria-hidden />
          <input
            type="search"
            aria-label="Search notes and categories"
            placeholder="Search notes and categories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="Account" value={account} onChange={(e) => onAccount(e.target.value)}>
          <option value="">All accounts</option>
          {book.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {page?.entries.length === 0 && (
        <p className="empty">{search || account ? "Nothing matches." : "Nothing here yet. Add your first entry."}</p>
      )}
      <ul className="rows">
        {page?.entries.map((e) => {
          const amount = signed(e);
          const neutral = e.kind === "moved" || e.kind === "exchanged";
          return (
            <li key={e.id}>
              <button type="button" className="row" onClick={() => onOpen(e)}>
                <span className="row-main">
                  <span>{title(e, names)}</span>
                  <small className="muted">
                    {showDate(e.date)}
                    {e.kind === "spent" || e.kind === "received" ? ` · ${names.get(e.account) ?? ""}` : ""}
                    {e.paid ? ` · ${money(e.paid.amount, e.paid.currency)}` : ""}
                    {e.memo ? ` · ${e.memo}` : ""}
                  </small>
                </span>
                <span className="row-end">
                  <span className={`amount ${!neutral && amount > 0 ? "pos" : ""}`}>
                    {!neutral && amount > 0 ? "+" : ""}
                    {money(amount, e.currency)}
                  </span>
                  {e.arrived ? (
                    <small className="muted">became {money(e.arrived.amount, e.arrived.currency)}</small>
                  ) : (
                    e.currency !== "USD" && (
                      <small className="muted">{money(e.kind === "spent" ? -e.usd : e.usd)}</small>
                    )
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {page && page.entries.length < page.total && (
        <button type="button" className="btn more" onClick={more}>
          Show more
        </button>
      )}
    </section>
  );
}

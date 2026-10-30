import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Book, MoneyAccount } from "../../shared/protocol.ts";
import { KIND_NAMES, money } from "../format.ts";
import { BalanceText } from "./Home.tsx";

function AccountCard({
  account,
  onEdit,
  onCheck,
  onActivity,
}: {
  account: MoneyAccount;
  onEdit: () => void;
  onCheck: () => void;
  onActivity: () => void;
}) {
  return (
    <li className="account-card">
      <div className="account-card-top">
        <div>
          <p className="account-name">{account.name}</p>
          <small className="muted">
            {KIND_NAMES[account.kind]} · {account.currency}
          </small>
        </div>
        <div className="row-end">
          <BalanceText account={account} />
          {account.currency !== "USD" && account.usdNow !== null && (
            <small className="muted">
              ≈ {money(account.kind === "card" ? Math.abs(account.usdNow) : account.usdNow)}
            </small>
          )}
        </div>
      </div>
      <div className="account-card-actions">
        {!account.closed && (
          <button type="button" className="btn" onClick={onCheck}>
            Check balance
          </button>
        )}
        <button type="button" className="btn" onClick={onActivity}>
          Activity
        </button>
        <button type="button" className="btn" onClick={onEdit}>
          Change
        </button>
      </div>
    </li>
  );
}

export function Accounts({
  book,
  onAdd,
  onEdit,
  onCheck,
  onActivity,
}: {
  book: Book;
  onAdd: () => void;
  onEdit: (account: MoneyAccount) => void;
  onCheck: (account: MoneyAccount) => void;
  onActivity: (account: MoneyAccount) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const open = book.accounts.filter((a) => !a.closed);
  const closed = book.accounts.filter((a) => a.closed);
  const groups = new Map<string, MoneyAccount[]>();
  for (const a of open) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);

  const card = (a: MoneyAccount) => (
    <AccountCard
      key={a.id}
      account={a}
      onEdit={() => onEdit(a)}
      onCheck={() => onCheck(a)}
      onActivity={() => onActivity(a)}
    />
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Accounts</h1>
        <button type="button" className="btn" onClick={onAdd}>
          <Plus aria-hidden /> Add account
        </button>
      </div>
      {book.accounts.length === 0 && <p className="empty">No accounts yet.</p>}
      {[...groups].map(([group, rows]) => (
        <section key={group} className="account-group">
          {group && <h3>{group}</h3>}
          <ul className="account-cards">{rows.map(card)}</ul>
        </section>
      ))}
      {closed.length > 0 && (
        <section className="account-group">
          <button type="button" className="link disclosure" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            Closed accounts ({closed.length})
          </button>
          {showClosed && <ul className="account-cards">{closed.map(card)}</ul>}
        </section>
      )}
      <p className="footnote">
        <strong>Your copy of everything:</strong> <a href="/api/export.csv">spreadsheet (CSV)</a> or{" "}
        <a href="/api/export.json">full backup (JSON)</a>.
      </p>
    </section>
  );
}

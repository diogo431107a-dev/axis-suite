import { useEffect, useState } from "react";
import { Bitcoin, CircleAlert, Plus } from "lucide-react";
import { CURRENCY_INFO, type Coin } from "../../shared/currencies.ts";
import { USDC_PEG, type Book, type Holding, type Holdings, type NewAccount } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { money, showDate } from "../format.ts";

const SETUP: { name: string; group: string; currency: Coin }[] = [
  { name: "Coinbase BTC", group: "Coinbase", currency: "BTC" },
  { name: "Coinbase ICP", group: "Coinbase", currency: "ICP" },
  { name: "Coinbase USDC", group: "Coinbase", currency: "USDC" },
  { name: "Sparrow BTC", group: "Sparrow", currency: "BTC" },
];

const signedMoney = (cents: number) => `${cents > 0 ? "+" : ""}${money(cents)}`;
const gainClass = (cents: number) => (cents > 0 ? "pos" : cents < 0 ? "neg" : "");

function CoinCard({ holding, onOpenAccount }: { holding: Holding; onOpenAccount: (id: string) => void }) {
  const { coin, quantity, price, value, cost, realized, short, accounts } = holding;
  const gain = value === null ? null : value - cost;
  return (
    <li className="coin">
      <div className="coin-top">
        <div>
          <p className="account-name">{CURRENCY_INFO[coin].name}</p>
          <p className="amount">{money(quantity, coin)}</p>
        </div>
        <div className="row-end">
          <span className="coin-value amount">{value === null ? "No price yet" : money(value)}</span>
          {price && (
            <small className="muted">
              {price.source === USDC_PEG ? "Counted as $1" : `1 ${coin} = ${money(Math.round(price.value * 100))}`}
            </small>
          )}
        </div>
      </div>
      <dl className="coin-figures">
        <div>
          <dt>What it cost</dt>
          <dd>{money(cost)}</dd>
        </div>
        <div>
          <dt>Gain so far</dt>
          <dd className={gain === null ? "" : gainClass(gain)}>{gain === null ? "—" : signedMoney(gain)}</dd>
        </div>
        <div>
          <dt>From coins sold</dt>
          <dd className={gainClass(realized)}>{signedMoney(realized)}</dd>
        </div>
      </dl>
      {short && (
        <p className="notice" role="status">
          <CircleAlert aria-hidden /> More has gone out than Fafnir has seen come in, so what it cost looks too low. Is
          an entry missing?
        </p>
      )}
      {coin === "USDC" && price && price.source !== USDC_PEG && (
        <p className="notice" role="status">
          <CircleAlert aria-hidden /> USDC is more than 1% away from a dollar, so it's valued at the market price from{" "}
          {price.source} ({showDate(price.date)}).
        </p>
      )}
      <ul className="coin-places">
        {accounts.map((a) => (
          <li key={a.id}>
            <button type="button" className="row" onClick={() => onOpenAccount(a.id)}>
              <span className="row-main">{a.name}</span>
              <span className="amount">{money(a.balance, coin)}</span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The coins: how much, where, what they cost and what they're worth, all in US dollars. */
export function Crypto({
  book,
  version,
  onChanged,
  onAddAccount,
  onOpenAccount,
}: {
  book: Book;
  /** Raised when something is saved, so the figures load again. */
  version: number;
  onChanged: () => void;
  onAddAccount: () => void;
  onOpenAccount: (id: string) => void;
}) {
  const [data, setData] = useState<Holdings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Holdings>("/api/holdings")
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

  async function setUp() {
    setSaving(true);
    setError("");
    try {
      const taken = new Set(book.accounts.map((a) => a.name.toLowerCase()));
      for (const { name, group, currency } of SETUP) {
        if (taken.has(name.toLowerCase())) continue;
        const account: NewAccount = { id: crypto.randomUUID(), name, group, currency, kind: "crypto" };
        await api("/api/accounts", { method: "POST", body: account });
      }
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
    setSaving(false);
  }

  const failure = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );
  if (!data) return failure || null;

  if (data.holdings.length === 0) {
    return (
      <div className="welcome">
        <h1>
          <Bitcoin aria-hidden className="heading-icon" /> Your crypto
        </h1>
        <p>
          Keep track of Bitcoin, ICP and USDC here: how much you have, where it sits, what it cost you and what it's
          worth now.
        </p>
        <p>
          Fafnir only keeps records. It never connects to a wallet or an exchange, and it never asks for a seed phrase,
          a private key or an API key.
        </p>
        {failure}
        <div className="welcome-actions">
          <button type="button" className="btn primary" disabled={saving} onClick={() => void setUp()}>
            {saving ? "Setting up…" : "Set up Coinbase and Sparrow"}
          </button>
          <button type="button" className="btn" onClick={onAddAccount}>
            Add an account of my own
          </button>
        </div>
      </div>
    );
  }

  const priced = data.holdings.every((h) => h.value !== null);
  const value = data.holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);
  const cost = data.holdings.reduce((sum, h) => sum + h.cost, 0);
  const realized = data.holdings.reduce((sum, h) => sum + h.realized, 0);

  return (
    <>
      <section className="worth">
        <p className="label">What my crypto is worth</p>
        <p className="worth-number">{money(value)}</p>
        <dl className="worth-parts">
          <div>
            <dt>What it cost</dt>
            <dd>{money(cost)}</dd>
          </div>
          <div>
            <dt>Gain so far</dt>
            <dd className={priced ? gainClass(value - cost) : ""}>{priced ? signedMoney(value - cost) : "—"}</dd>
          </div>
          <div>
            <dt>From coins sold</dt>
            <dd className={gainClass(realized)}>{signedMoney(realized)}</dd>
          </div>
        </dl>
        {!priced && (
          <p className="notice" role="status">
            <CircleAlert aria-hidden /> A price isn't available yet, so that coin isn't counted in what it's worth.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h1>Coins</h1>
          <button type="button" className="btn" onClick={onAddAccount}>
            <Plus aria-hidden /> Add account
          </button>
        </div>
        {failure}
        <ul className="coins">
          {data.holdings.map((h) => (
            <CoinCard key={h.coin} holding={h} onOpenAccount={onOpenAccount} />
          ))}
        </ul>
        <p className="footnote">
          What a coin cost is the average of what you paid, in US dollars, and moving it between your accounts doesn't
          change it. Fees are spending, not part of what it cost. "From coins sold" is what you made selling or spending
          coins, beyond what they cost. These figures are for your own view: they aren't a tax calculation or investment
          advice.
        </p>
      </section>
    </>
  );
}

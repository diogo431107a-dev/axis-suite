import { useEffect, useState } from "react";
import { Car, ChevronDown, ChevronRight, CircleAlert, Plus } from "lucide-react";
import type { AssetSummary, Assets as AssetsData } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { money, showDate } from "../format.ts";

export interface AssetActions {
  onValue: (asset: AssetSummary) => void;
  onSell: (asset: AssetSummary) => void;
  onActivity: (asset: AssetSummary) => void;
  onEdit: (asset: AssetSummary) => void;
}

const signedMoney = (amount: number, currency: AssetSummary["currency"]) =>
  `${amount > 0 ? "+" : ""}${money(amount, currency)}`;

function AssetCard({ asset, actions }: { asset: AssetSummary; actions: AssetActions }) {
  const { currency, value, usdValue, paid, owned, changes, sold, updated, closed } = asset;
  return (
    <li className="account-card loan">
      <div className="account-card-top">
        <div>
          <p className="account-name">{asset.name}</p>
          <small className="muted">{updated ? `${closed ? "Sold" : "Updated"} ${showDate(updated)}` : ""}</small>
        </div>
        <div className="row-end">
          <span className="coin-value amount">{money(closed ? sold : value, currency)}</span>
          <small className="muted">{closed ? "sold for" : "worth now"}</small>
          {!closed && currency !== "USD" && usdValue !== null && <small className="muted">≈ {money(usdValue)}</small>}
        </div>
      </div>
      <dl className="coin-figures">
        <div>
          <dt>{paid > 0 ? "Bought for" : "Worth when added"}</dt>
          <dd>{money(paid > 0 ? paid : owned, currency)}</dd>
        </div>
        <div>
          <dt>Value changes</dt>
          <dd className={changes > 0 ? "pos" : changes < 0 ? "neg" : ""}>{signedMoney(changes, currency)}</dd>
        </div>
      </dl>
      <div className="account-card-actions">
        {!closed && (
          <>
            <button type="button" className="btn" onClick={() => actions.onValue(asset)}>
              New value
            </button>
            <button type="button" className="btn" onClick={() => actions.onSell(asset)}>
              Sold it
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={() => actions.onActivity(asset)}>
          Activity
        </button>
        <button type="button" className="btn" onClick={() => actions.onEdit(asset)}>
          Change
        </button>
      </div>
    </li>
  );
}

/** Things the user owns that aren't money, at a value they type. */
export function Assets({
  version,
  onAdd,
  actions,
}: {
  /** Raised when something is saved, so the figures load again. */
  version: number;
  onAdd: () => void;
  actions: AssetActions;
}) {
  const [data, setData] = useState<AssetsData | null>(null);
  const [error, setError] = useState("");
  const [showSold, setShowSold] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<AssetsData>("/api/assets")
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

  if (data.assets.length === 0) {
    return (
      <div className="welcome">
        <h1>
          <Car aria-hidden className="heading-icon" /> Things I own
        </h1>
        <p>
          A car, a house or anything else you could sell, counted in what you're worth at a value you type. Buying one
          isn't spending: the money becomes the thing.
        </p>
        <p>Give it a new value whenever you like, from a car's FIPE price or a valuation. Fafnir never looks it up.</p>
        {failure}
        <button type="button" className="btn primary" onClick={onAdd}>
          Add something I own
        </button>
      </div>
    );
  }

  const owned = data.assets.filter((a) => !a.closed);
  const sold = data.assets.filter((a) => a.closed);
  const total = owned.reduce((sum, a) => sum + (a.usdValue ?? 0), 0);

  return (
    <>
      {failure}
      <section className="panel">
        <div className="panel-head">
          <h1>Things I own</h1>
          <button type="button" className="btn" onClick={onAdd}>
            <Plus aria-hidden /> Add something
          </button>
        </div>
        {owned.some((a) => a.usdValue === null) && (
          <p className="notice" role="status">
            <CircleAlert aria-hidden /> A rate isn't available yet, so some things aren't counted in the total.
          </p>
        )}
        {owned.length > 0 && (
          <div className="loan-section">
            <h2>Worth now</h2>
            <span className="amount">{money(total)}</span>
          </div>
        )}
        <ul className="account-cards">
          {owned.map((a) => (
            <AssetCard key={a.id} asset={a} actions={actions} />
          ))}
        </ul>
        {sold.length > 0 && (
          <section className="account-group">
            <button type="button" className="link disclosure" onClick={() => setShowSold(!showSold)}>
              {showSold ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              Sold ({sold.length})
            </button>
            {showSold && (
              <ul className="account-cards">
                {sold.map((a) => (
                  <AssetCard key={a.id} asset={a} actions={actions} />
                ))}
              </ul>
            )}
          </section>
        )}
        <p className="footnote">
          Values are what you type. A new value isn't spending or income: it shows on Home as a value change.
        </p>
      </section>
    </>
  );
}

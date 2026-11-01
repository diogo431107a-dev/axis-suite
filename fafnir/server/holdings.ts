// What each coin cost: replays what happened to a coin, oldest first, keeping its average cost in US
// dollars. Worked out afresh each time and never stored, so changing an old entry can't leave it wrong.
// This is for the user's own view of their money. It isn't a tax calculation.
import type { Coin } from "../shared/currencies.ts";

/** What one transaction did to one coin, across all of a user's crypto accounts. */
export interface CoinChange {
  coin: Coin;
  kind: string;
  /** Up or down, in the coin's smallest unit. A move between a user's own accounts only shows its fee. */
  amount: number;
  /** What that change was worth, in US cents, with the same sign. */
  usd: number;
}

export interface CoinCost {
  /** In the coin's smallest unit. Below zero if more went out than ever came in. */
  quantity: number;
  /** What the quantity held cost, in US cents. */
  cost: number;
  /** What selling or spending it made beyond what it cost, in US cents; below zero for a loss. */
  realized: number;
  /** Some of what went out has no recorded purchase, and so counts as having cost nothing. */
  short: boolean;
}

/** Corrections and opening balances say what is there, not that anything was sold. */
const NOT_A_SALE = new Set(["adjustment", "starting"]);

export function coinCosts(changes: readonly CoinChange[]): Map<Coin, CoinCost> {
  const costs = new Map<Coin, CoinCost>();
  for (const { coin, kind, amount, usd } of changes) {
    if (amount === 0) continue;
    const held = costs.get(coin) ?? { quantity: 0, cost: 0, realized: 0, short: false };
    costs.set(coin, held);

    if (amount > 0) {
      // Whatever only fills a hole left by selling more than was recorded has nothing to add.
      const kept = held.quantity < 0 ? Math.max(0, held.quantity + amount) : amount;
      held.cost += usd * (kept / amount);
      held.quantity += amount;
      continue;
    }

    const out = -amount;
    const covered = Math.max(0, Math.min(out, held.quantity));
    if (covered < out) held.short = true;
    const costOut = held.quantity > 0 ? held.cost * (covered / held.quantity) : 0;
    held.cost -= costOut;
    held.quantity += amount;
    if (!NOT_A_SALE.has(kind)) held.realized += -usd - costOut;
  }
  for (const held of costs.values()) {
    held.cost = Math.round(held.cost);
    held.realized = Math.round(held.realized);
  }
  return costs;
}

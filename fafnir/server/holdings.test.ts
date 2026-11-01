import { describe, expect, it } from "vitest";
import { coinCosts, type CoinChange } from "./holdings.ts";

const BTC = 100_000_000;

const change = (kind: string, amount: number, usd: number): CoinChange => ({ coin: "BTC", kind, amount, usd });
const btc = (...changes: CoinChange[]) => coinCosts(changes).get("BTC")!;

describe("what a coin cost", () => {
  it("averages buys at two prices", () => {
    expect(btc(change("exchanged", BTC, 5_000_000), change("exchanged", BTC, 7_000_000))).toEqual({
      quantity: 2 * BTC,
      cost: 12_000_000,
      realized: 0,
      short: false,
    });
  });

  it("takes a sale out at the average, and keeps the gain", () => {
    const held = btc(
      change("exchanged", BTC, 5_000_000),
      change("exchanged", BTC, 7_000_000),
      // Half of the coins, worth $80,000.
      change("exchanged", -BTC, -8_000_000),
    );
    expect(held).toEqual({ quantity: BTC, cost: 6_000_000, realized: 2_000_000, short: false });
  });

  it("keeps a loss below zero", () => {
    const held = btc(change("exchanged", BTC, 5_000_000), change("spent", -BTC / 2, -1_000_000));
    expect(held.realized).toBe(-1_500_000);
    expect(held.cost).toBe(2_500_000);
  });

  it("isn't changed by a move, which shows only as its network fee", () => {
    // Moving between accounts: what left and what arrived add up to what the fee took.
    const held = btc(change("exchanged", BTC, 5_000_000), change("moved", -BTC / 1_000, -6_000));
    expect(held.quantity).toBe(BTC - BTC / 1_000);
    // The cost of what is left stays at the same $50,000 a coin.
    expect(held.cost).toBe(4_995_000);
    // The fee went out at a price above what it cost: $60 for what cost $50.
    expect(held.realized).toBe(1_000);
  });

  it("counts a staking reward at the day's value", () => {
    const held = btc(change("received", BTC, 6_000_000));
    expect(held.cost).toBe(6_000_000);
    expect(held.realized).toBe(0);
  });

  it("takes a starting balance's value as its cost, even if that is nothing", () => {
    expect(btc(change("starting", BTC, 1_000_000)).cost).toBe(1_000_000);
    expect(btc(change("starting", BTC, 0)).cost).toBe(0);
    expect(btc(change("starting", BTC, 0), change("exchanged", -BTC, -5_000_000)).realized).toBe(5_000_000);
  });

  it("treats a balance check going down as a correction, not a sale", () => {
    const held = btc(change("exchanged", BTC, 5_000_000), change("adjustment", -BTC / 2, -4_000_000));
    expect(held).toEqual({ quantity: BTC / 2, cost: 2_500_000, realized: 0, short: false });
  });

  it("flags selling more than recorded, counting the rest as having cost nothing", () => {
    const held = btc(change("exchanged", BTC, 5_000_000), change("exchanged", -2 * BTC, -12_000_000));
    expect(held.quantity).toBe(-BTC);
    expect(held.cost).toBe(0);
    expect(held.realized).toBe(7_000_000);
    expect(held.short).toBe(true);
  });

  it("recovers from a hole when more arrives, costing only what is left over", () => {
    const held = btc(change("exchanged", -BTC, -5_000_000), change("exchanged", 3 * BTC, 15_000_000));
    expect(held.quantity).toBe(2 * BTC);
    expect(held.cost).toBe(10_000_000);
    expect(held.short).toBe(true);
  });

  it("empties cleanly, and starts fresh", () => {
    const held = btc(
      change("exchanged", BTC, 3_333_333),
      change("exchanged", -BTC, -4_000_000),
      change("exchanged", BTC, 7_000_000),
    );
    expect(held).toEqual({ quantity: BTC, cost: 7_000_000, realized: 666_667, short: false });
  });

  it("keeps coins apart", () => {
    const costs = coinCosts([
      { coin: "BTC", kind: "exchanged", amount: BTC, usd: 5_000_000 },
      { coin: "ICP", kind: "received", amount: BTC, usd: 1_000 },
    ]);
    expect(costs.get("BTC")!.cost).toBe(5_000_000);
    expect(costs.get("ICP")!.cost).toBe(1_000);
    expect(costs.has("USDC")).toBe(false);
  });
});

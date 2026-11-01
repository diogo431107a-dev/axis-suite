import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.ts";
import { addDays, createRates, lastDayOf, type DayRate, type RateSource } from "./rates.ts";

let db: DatabaseSync;
let bank: ReturnType<typeof vi.fn<RateSource["fetch"]>>;
let backup: ReturnType<typeof vi.fn<RateSource["fetch"]>>;

const sources = () => ({
  BRL: [
    { name: "Banco Central (PTAX)", fetch: bank },
    { name: "Frankfurter", fetch: backup },
  ],
});
const answer = (...rows: DayRate[]) => Promise.resolve(rows);

beforeEach(() => {
  db = openDatabase(":memory:");
  bank = vi.fn<RateSource["fetch"]>(() => answer());
  backup = vi.fn<RateSource["fetch"]>(() => answer());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("rates", () => {
  it("uses the closest earlier day when a day has no rate, like a weekend", async () => {
    bank.mockImplementation(() => answer({ date: "2026-10-23", value: 5.04 }));
    const rates = createRates(db, sources());
    await rates.ensure("2026-10-25");
    expect(rates.lookup("BRL", "2026-10-25")).toEqual({
      currency: "BRL",
      value: 5.04,
      date: "2026-10-23",
      source: "Banco Central (PTAX)",
    });
    expect(rates.lookup("BRL", "2026-10-22")).toBeNull();
  });

  it("doesn't ask again for a day it already covers", async () => {
    bank.mockImplementation(() => answer({ date: "2026-10-23", value: 5.04 }));
    const rates = createRates(db, sources());
    await rates.ensure("2026-10-23");
    await rates.ensure("2026-10-25");
    expect(bank).toHaveBeenCalledTimes(1);
  });

  it("fetches around an old date when it has nothing near it", async () => {
    bank.mockImplementation((from, to) => answer({ date: to, value: 3 }, { date: from, value: 3.1 }));
    const rates = createRates(db, sources());
    await rates.ensure("2015-03-06");
    expect(bank).toHaveBeenCalledWith(addDays("2015-03-06", -10), "2015-03-06");
    expect(rates.lookup("BRL", "2015-03-06")!.value).toBe(3);
  });

  it("falls back on the second source, and the bank's figure replaces it later", async () => {
    bank.mockImplementationOnce(() => Promise.reject(new Error("down")));
    backup.mockImplementation(() => answer({ date: "2026-10-23", value: 5.1 }));
    const rates = createRates(db, sources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("BRL", "2026-10-23")).toEqual({
      currency: "BRL",
      value: 5.1,
      date: "2026-10-23",
      source: "Frankfurter",
    });

    bank.mockImplementation(() => answer({ date: "2026-10-23", value: 5.04 }));
    await createRates(db, sources()).refresh();
    expect(rates.lookup("BRL", "2026-10-23")!.value).toBe(5.04);

    // The other way round doesn't happen, even if the bank is down again.
    bank.mockImplementation(() => Promise.reject(new Error("down")));
    backup.mockImplementation(() => answer({ date: "2026-10-23", value: 5.1 }));
    await createRates(db, sources()).refresh();
    expect(rates.lookup("BRL", "2026-10-23")!.value).toBe(5.04);
  });

  it("never throws, and doesn't keep entries waiting while the sources are down", async () => {
    bank.mockImplementation(() => Promise.reject(new Error("down")));
    backup.mockImplementation(() => Promise.reject(new Error("down")));
    const rates = createRates(db, sources());
    await expect(rates.ensure("2026-10-23")).resolves.toBeUndefined();
    await rates.ensure("2026-10-23");
    expect(bank).toHaveBeenCalledTimes(1);
    expect(rates.lookup("BRL", "2026-10-23")).toBeNull();
  });

  it("ignores figures that can't be a rate", async () => {
    bank.mockImplementation(() =>
      answer(
        { date: "2026-10-21", value: 0 },
        { date: "2026-10-22", value: 5000 },
        { date: "2026-10-23", value: undefined as unknown as number },
      ),
    );
    const rates = createRates(db, sources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("BRL", "2026-10-23")).toBeNull();
  });
});

describe("coins", () => {
  const coinbase = vi.fn<RateSource["fetch"]>();
  const kraken = vi.fn<RateSource["fetch"]>();
  const coinSources = () => ({
    BTC: [
      { name: "Coinbase", fetch: coinbase },
      { name: "Kraken", fetch: kraken },
    ],
  });

  beforeEach(() => {
    coinbase.mockReset();
    kraken.mockReset();
  });

  it("gives a coin's price in dollars, from the main source", async () => {
    coinbase.mockImplementation(() => answer({ date: "2026-10-23", value: 77_000 }));
    const rates = createRates(db, coinSources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("BTC", "2026-10-23")).toEqual({
      currency: "BTC",
      value: 77_000,
      date: "2026-10-23",
      source: "Coinbase",
    });
    expect(kraken).not.toHaveBeenCalled();
  });

  it("falls back on Kraken when Coinbase fails, and keeps each coin apart", async () => {
    coinbase.mockImplementation(() => Promise.reject(new Error("down")));
    kraken.mockImplementation(() => answer({ date: "2026-10-23", value: 76_000 }));
    const rates = createRates(db, coinSources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("BTC", "2026-10-23")!.source).toBe("Kraken");
    expect(rates.lookup("ICP", "2026-10-23")).toBeNull();
    expect(rates.lookup("BRL", "2026-10-23")).toBeNull();
  });

  it("needs no rate for dollars", () => {
    expect(createRates(db, {}).lookup("USD", "2026-10-23")).toBeNull();
  });

  it("doesn't take a price that can't be one", async () => {
    coinbase.mockImplementation(() => answer({ date: "2026-10-23", value: 0 }));
    const rates = createRates(db, coinSources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("BTC", "2026-10-23")).toBeNull();
  });

  it("doesn't ask again about a day a source has already answered for, such as before a coin existed", async () => {
    coinbase.mockImplementation(() => answer());
    const rates = createRates(db, coinSources());
    await rates.ensure("2015-01-01");
    await rates.ensure("2015-01-01");
    expect(coinbase).toHaveBeenCalledTimes(1);
  });
});

describe("USDC", () => {
  const usdc = vi.fn<RateSource["fetch"]>();
  const usdcSources = () => ({ USDC: [{ name: "Kraken", fetch: usdc }] });

  beforeEach(() => usdc.mockReset());

  it("counts as exactly a dollar when nothing is known", () => {
    expect(createRates(db, {}).lookup("USDC", "2026-10-23")).toEqual({
      currency: "USDC",
      value: 1,
      date: "2026-10-23",
      source: "Counted as $1",
    });
  });

  it("counts as exactly a dollar within 1% of one", async () => {
    usdc.mockImplementation(() => answer({ date: "2026-10-23", value: 0.9997 }));
    const rates = createRates(db, usdcSources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("USDC", "2026-10-23")!.value).toBe(1);
  });

  it("uses the market's figure when it is further away", async () => {
    usdc.mockImplementation(() => answer({ date: "2026-10-23", value: 0.88 }));
    const rates = createRates(db, usdcSources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("USDC", "2026-10-23")).toEqual({
      currency: "USDC",
      value: 0.88,
      date: "2026-10-23",
      source: "Kraken",
    });
  });
});

describe("refreshing", () => {
  it("fetches only what is due", async () => {
    const coin = vi.fn<RateSource["fetch"]>(() => answer());
    const rates = createRates(db, { BTC: [{ name: "Coinbase", fetch: coin }] });
    await rates.refresh();
    await rates.refresh();
    expect(coin).toHaveBeenCalledTimes(1);
  });
});

describe("months", () => {
  it("knows their last day", () => {
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2024-02")).toBe("2024-02-29");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });
});

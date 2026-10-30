import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.ts";
import { addDays, createRates, lastDayOf, type DayRate, type RateSource } from "./rates.ts";

let db: DatabaseSync;
let bank: ReturnType<typeof vi.fn<RateSource["fetch"]>>;
let backup: ReturnType<typeof vi.fn<RateSource["fetch"]>>;

const sources = (): RateSource[] => [
  { name: "Banco Central (PTAX)", fetch: bank },
  { name: "Frankfurter", fetch: backup },
];
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
    expect(rates.lookup("2026-10-25")).toEqual({ value: 5.04, date: "2026-10-23", source: "Banco Central (PTAX)" });
    expect(rates.lookup("2026-10-22")).toBeNull();
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
    expect(rates.lookup("2015-03-06")!.value).toBe(3);
  });

  it("falls back on the second source, and the bank's figure replaces it later", async () => {
    bank.mockImplementationOnce(() => Promise.reject(new Error("down")));
    backup.mockImplementation(() => answer({ date: "2026-10-23", value: 5.1 }));
    const rates = createRates(db, sources());
    await rates.ensure("2026-10-23");
    expect(rates.lookup("2026-10-23")).toEqual({ value: 5.1, date: "2026-10-23", source: "Frankfurter" });

    bank.mockImplementation(() => answer({ date: "2026-10-23", value: 5.04 }));
    await rates.refresh();
    expect(rates.lookup("2026-10-23")!.value).toBe(5.04);

    // The other way round doesn't happen, even if the bank is down again.
    bank.mockImplementation(() => Promise.reject(new Error("down")));
    await rates.refresh();
    expect(rates.lookup("2026-10-23")!.value).toBe(5.04);
  });

  it("never throws, and doesn't keep entries waiting while the sources are down", async () => {
    bank.mockImplementation(() => Promise.reject(new Error("down")));
    backup.mockImplementation(() => Promise.reject(new Error("down")));
    const rates = createRates(db, sources());
    await expect(rates.ensure("2026-10-23")).resolves.toBeUndefined();
    await rates.ensure("2026-10-23");
    expect(bank).toHaveBeenCalledTimes(1);
    expect(rates.lookup("2026-10-23")).toBeNull();
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
    expect(rates.lookup("2026-10-23")).toBeNull();
  });
});

describe("months", () => {
  it("knows their last day", () => {
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2024-02")).toBe("2024-02-29");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });
});

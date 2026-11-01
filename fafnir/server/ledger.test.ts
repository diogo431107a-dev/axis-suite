import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDatabase } from "./db.ts";
import { createLedger, assertBalanced, type Ledger } from "./ledger.ts";
import { StoreError } from "./errors.ts";
import { today } from "./rates.ts";
import type { Currency, Rate } from "../shared/protocol.ts";

const RATE: Rate = { currency: "BRL", value: 5, date: "2026-10-01", source: "test" };
const ME = "odin";
const DAY = "2026-10-05";

let db: DatabaseSync;
let rate: Rate | null;
/** When set, the rate of each day instead of `rate`. */
let rateOn: ((date: string) => Rate | null) | null;
/** Dollars for one coin; a coin left out has no known price. */
let prices: Partial<Record<Currency, number>>;
/** When set, BTC's price on each day instead of the one in `prices`. */
let btcOn: ((date: string) => number) | null;
let ledger: Ledger;
let nextId = 0;
const id = () => `id-00000-${++nextId}`;

const category = (name: string, owner = ME) => {
  const found = ledger.load(owner, "2026-10").categories.find((c) => c.name === name);
  if (!found) throw new Error(`No category ${name}`);
  return found.id;
};

function addAccount(
  name: string,
  currency: Currency,
  kind: "bank" | "card" | "crypto" | "borrowed" | "lent" = currency === "USD" || currency === "BRL" ? "bank" : "crypto",
  starting = 0,
): string {
  const accountId = id();
  ledger.addAccount(ME, {
    id: accountId,
    name,
    kind,
    currency,
    ...(starting ? { starting, date: DAY } : {}),
  });
  return accountId;
}

const account = (accountId: string, owner = ME) => {
  const found = ledger.load(owner, "2026-10").accounts.find((a) => a.id === accountId);
  if (!found) throw new Error("No such account");
  return found;
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof StoreError) return err.code;
    throw err;
  }
  return "accepted";
};

/** The whole database: every transaction adds up to zero, in each currency and in dollars. */
function expectEverythingBalances() {
  const bad = db
    .prepare(
      `
      SELECT tx_id FROM postings GROUP BY tx_id, currency HAVING SUM(amount) <> 0
      UNION SELECT tx_id FROM postings GROUP BY tx_id HAVING SUM(usd) <> 0
    `,
    )
    .all();
  expect(bad).toEqual([]);
}

beforeEach(() => {
  db = openDatabase(":memory:");
  rate = RATE;
  rateOn = null;
  prices = { BTC: 50_000, ICP: 10, USDC: 1 };
  btcOn = null;
  ledger = createLedger(db, (currency, date) => {
    if (currency === "BRL") return rateOn ? rateOn(date) : rate;
    const value = currency === "BTC" && btcOn ? btcOn(date) : prices[currency];
    return value === undefined ? null : { currency: currency as "BTC", value, date, source: "test" };
  });
});

describe("a new user", () => {
  it("starts with categories and no accounts", () => {
    const book = ledger.load(ME, "2026-10");
    expect(book.accounts).toEqual([]);
    expect(book.categories.map((c) => c.name)).toContain("Food");
    expect(book.categories.map((c) => c.name)).not.toContain("Starting balance");
    expect(book.have).toBe(0);
  });
});

describe("entries", () => {
  it("records a BRL expense with its dollars fixed at the day's rate", () => {
    const bank = addAccount("Itaú", "BRL");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "spent",
      date: DAY,
      account: bank,
      other: category("Food"),
      amount: 10_000,
    });
    expect(entry.usd).toBe(2_000);
    expect(entry.rate).toEqual(RATE);
    expect(account(bank).balance).toBe(-10_000);

    // The rate moves later: the entry stays, and the balance is valued at the new rate.
    rate = { ...RATE, value: 4 };
    expect(ledger.listEntries(ME, {}).entries[0]!.usd).toBe(2_000);
    expect(account(bank).usdNow).toBe(-2_500);
    expectEverythingBalances();
  });

  it("needs no rate for dollars", () => {
    rate = null;
    const bank = addAccount("Chase", "USD");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: DAY,
      account: bank,
      other: category("Salary"),
      amount: 50_000,
    });
    expect(entry.usd).toBe(50_000);
    expect(entry.rate).toBeNull();
  });

  it("asks for the dollars when no rate is known, and takes typed dollars", () => {
    rate = null;
    const bank = addAccount("Itaú", "BRL");
    const input = {
      id: id(),
      kind: "spent" as const,
      date: DAY,
      account: bank,
      other: category("Food"),
      amount: 10_000,
    };
    expect(code(() => ledger.addEntry(ME, input))).toBe("no-rate");
    const entry = ledger.addEntry(ME, { ...input, usd: 1_850 });
    expect(entry.usd).toBe(1_850);
    expect(entry.rate).toBeNull();
    expectEverythingBalances();
  });

  it("saves an entry sent twice once", () => {
    const bank = addAccount("Itaú", "BRL");
    const input = {
      id: id(),
      kind: "spent" as const,
      date: DAY,
      account: bank,
      other: category("Food"),
      amount: 500,
    };
    ledger.addEntry(ME, input);
    ledger.addEntry(ME, input);
    expect(account(bank).balance).toBe(-500);
    expect(ledger.listEntries(ME, {}).total).toBe(1);
  });

  it("moves money between accounts, paying a card", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 100_000);
    const card = addAccount("Nubank", "BRL", "card", -30_000);
    ledger.addEntry(ME, { id: id(), kind: "moved", date: DAY, account: bank, other: card, amount: 30_000 });
    expect(account(bank).balance).toBe(70_000);
    expect(account(card).balance).toBe(0);
    expectEverythingBalances();
  });

  it("refuses what doesn't make sense", () => {
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    const food = category("Food");
    const base = { kind: "spent" as const, date: DAY, account: brl, other: food, amount: 100 };
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), amount: 0 }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), amount: 1.5 }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), date: "2026-02-31" }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), date: "2999-01-01" }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), other: category("Salary") }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), other: usd }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "moved", other: usd }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "moved", other: brl }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), account: food }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), account: "nope" }))).toBe("not-found");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), usd: -5 }))).toBe("invalid");
    expect(ledger.listEntries(ME, {}).total).toBe(0);
  });

  it("keeps the dollars when an edit doesn't touch the amount or the date", () => {
    const bank = addAccount("Itaú", "BRL");
    const added = ledger.addEntry(ME, {
      id: id(),
      kind: "spent",
      date: DAY,
      account: bank,
      other: category("Food"),
      amount: 10_000,
    });
    rate = { ...RATE, value: 4 };
    const change = { kind: "spent" as const, date: DAY, account: bank, other: category("Fun"), amount: 10_000 };
    const renamed = ledger.changeEntry(ME, added.id, { ...change, memo: "Pizza" });
    expect(renamed.usd).toBe(2_000);
    expect(renamed.rate).toEqual(RATE);
    expect(renamed.memo).toBe("Pizza");

    const changed = ledger.changeEntry(ME, added.id, { ...change, amount: 20_000 });
    expect(changed.usd).toBe(5_000);
    expectEverythingBalances();
  });

  it("keeps the earlier version of a changed or deleted entry", () => {
    const bank = addAccount("Itaú", "BRL");
    const food = category("Food");
    const added = ledger.addEntry(ME, { id: id(), kind: "spent", date: DAY, account: bank, other: food, amount: 100 });
    ledger.changeEntry(ME, added.id, { kind: "spent", date: DAY, account: bank, other: food, amount: 200 });
    ledger.removeEntry(ME, added.id);
    const { history, entries } = ledger.exportAll(ME) as {
      history: { action: string; snapshot: { amount: number } }[];
      entries: unknown[];
    };
    expect(entries).toEqual([]);
    expect(history.map((h) => [h.action, h.snapshot.amount])).toEqual([
      ["changed", 100],
      ["deleted", 200],
    ]);
    expect(account(bank).balance).toBe(0);
  });

  it("keeps each user's books apart", () => {
    const bank = addAccount("Itaú", "BRL");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "spent",
      date: DAY,
      account: bank,
      other: category("Food"),
      amount: 100,
    });
    expect(code(() => ledger.removeEntry("freya", entry.id))).toBe("not-found");
    expect(
      code(() =>
        ledger.addEntry("freya", {
          id: id(),
          kind: "spent",
          date: DAY,
          account: bank,
          other: category("Food", "freya"),
          amount: 100,
        }),
      ),
    ).toBe("not-found");
    expect(ledger.listEntries("freya", {}).total).toBe(0);
  });

  it("finds entries by note, category and account", () => {
    const bank = addAccount("Itaú", "BRL");
    const other = addAccount("Caixa", "BRL");
    const base = { kind: "spent" as const, date: DAY, amount: 100 };
    ledger.addEntry(ME, { ...base, id: id(), account: bank, other: category("Food"), memo: "100% pizza" });
    ledger.addEntry(ME, { ...base, id: id(), account: other, other: category("Fun") });
    expect(ledger.listEntries(ME, { q: "pizza" }).total).toBe(1);
    expect(ledger.listEntries(ME, { q: "100%" }).total).toBe(1);
    expect(ledger.listEntries(ME, { q: "%" }).total).toBe(1);
    expect(ledger.listEntries(ME, { q: "fun" }).total).toBe(1);
    expect(ledger.listEntries(ME, { account: other }).total).toBe(1);
  });
});

describe("balances and totals", () => {
  it("adds up what you have and what you owe in dollars", () => {
    addAccount("Chase", "USD", "bank", 100_000);
    addAccount("Itaú", "BRL", "bank", 50_000);
    addAccount("Nubank", "BRL", "card", -25_000);
    const book = ledger.load(ME, "2026-10");
    expect(book.have).toBe(110_000);
    expect(book.owe).toBe(5_000);
    expect(book.missingRate).toBe(false);
  });

  it("says when a BRL balance is left out for want of a rate", () => {
    addAccount("Chase", "USD", "bank", 100_000);
    const brl = addAccount("Itaú", "BRL");
    ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: DAY,
      account: brl,
      other: category("Salary"),
      amount: 500,
    });
    rate = null;
    const book = ledger.load(ME, "2026-10");
    expect(book.have).toBe(100_000);
    expect(book.missingRate).toBe(true);
  });

  it("sums a month's money in and out in dollars, leaving out moves and starting balances", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 1_000_000);
    const other = addAccount("Caixa", "BRL");
    const base = { date: DAY, account: bank };
    ledger.addEntry(ME, { ...base, id: id(), kind: "received", other: category("Salary"), amount: 50_000 });
    ledger.addEntry(ME, { ...base, id: id(), kind: "spent", other: category("Food"), amount: 5_000 });
    ledger.addEntry(ME, { ...base, id: id(), kind: "spent", other: category("Fun"), amount: 10_000 });
    ledger.addEntry(ME, { ...base, id: id(), kind: "moved", other, amount: 7_000 });
    ledger.addEntry(ME, { ...base, id: id(), date: "2026-09-30", kind: "spent", other: category("Food"), amount: 99 });
    const { month } = ledger.load(ME, "2026-10");
    expect(month.moneyIn).toBe(10_000);
    expect(month.moneyOut).toBe(3_000);
    expect(month.spending).toEqual([
      { category: category("Fun"), usd: 2_000 },
      { category: category("Food"), usd: 1_000 },
    ]);
  });
});

describe("accounts", () => {
  it("won't take the same name twice, but a category can share an account's", () => {
    addAccount("Itaú", "BRL");
    expect(code(() => addAccount("itaú", "USD"))).toBe("conflict");
    expect(code(() => ledger.addCategory(ME, { id: id(), name: "Itaú", kind: "expense" }))).toBe("accepted");
    expect(code(() => ledger.addCategory(ME, { id: id(), name: "food", kind: "expense" }))).toBe("conflict");
  });

  it("closes only an empty account, and a closed one takes no new entries", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 100);
    const food = category("Food");
    expect(code(() => ledger.changeAccount(ME, bank, { closed: true }))).toBe("conflict");
    ledger.addEntry(ME, { id: id(), kind: "spent", date: DAY, account: bank, other: food, amount: 100 });
    ledger.changeAccount(ME, bank, { closed: true });
    expect(account(bank).closed).toBe(true);
    expect(
      code(() => ledger.addEntry(ME, { id: id(), kind: "spent", date: DAY, account: bank, other: food, amount: 1 })),
    ).toBe("invalid");
  });

  it("deletes only an account with no entries", () => {
    const empty = addAccount("Empty", "USD");
    const used = addAccount("Used", "USD", "bank", 100);
    ledger.removeAccount(ME, empty);
    expect(ledger.load(ME, "2026-10").accounts.map((a) => a.name)).toEqual(["Used"]);
    expect(code(() => ledger.removeAccount(ME, used))).toBe("conflict");
  });

  it("keeps a group", () => {
    const bank = addAccount("Itaú", "BRL");
    ledger.changeAccount(ME, bank, { group: "Brazil", kind: "savings" });
    expect(account(bank).group).toBe("Brazil");
    expect(account(bank).kind).toBe("savings");
  });

  it("edits a starting balance, which can be below zero", () => {
    const card = addAccount("Nubank", "BRL", "card", -1_000);
    const [entry] = ledger.listEntries(ME, {}).entries;
    expect(entry!.kind).toBe("starting");
    expect(entry!.amount).toBe(-1_000);
    expect(entry!.usd).toBe(-200);
    ledger.changeEntry(ME, entry!.id, { kind: "starting", date: DAY, account: card, amount: -2_000 });
    expect(account(card).balance).toBe(-2_000);
    expectEverythingBalances();
  });
});

describe("Exchanged", () => {
  it("takes one currency out and puts the other in, adding up to zero in each", () => {
    const brl = addAccount("Itaú", "BRL", "bank", 100_000);
    const usd = addAccount("Chase", "USD");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: brl,
      other: usd,
      amount: 55_000,
      arrived: 10_000,
    });
    expect(account(brl).balance).toBe(45_000);
    expect(account(usd).balance).toBe(10_000);
    expect(entry).toMatchObject({
      kind: "exchanged",
      account: brl,
      other: usd,
      currency: "BRL",
      amount: 55_000,
      usd: 10_000,
      arrived: { currency: "USD", amount: 10_000 },
      rate: null,
    });
    expectEverythingBalances();
  });

  it("values it by the dollars, going either way", () => {
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD", "bank", 50_000);
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: usd,
      other: brl,
      amount: 10_000,
      arrived: 53_000,
    });
    expect(entry.usd).toBe(10_000);
    expect(account(brl).balance).toBe(53_000);
    expectEverythingBalances();
  });

  it("needs no rate, and isn't money in or out", () => {
    rate = null;
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: brl,
      other: usd,
      amount: 500,
      arrived: 100,
    });
    const { month } = ledger.load(ME, "2026-10");
    expect(month.moneyIn).toBe(0);
    expect(month.moneyOut).toBe(0);
  });

  it("is listed under both accounts and can be changed or deleted", () => {
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: brl,
      other: usd,
      amount: 500,
      arrived: 100,
    });
    expect(ledger.listEntries(ME, { account: usd }).total).toBe(1);
    expect(ledger.listEntries(ME, { account: brl }).total).toBe(1);
    expect(ledger.listEntries(ME, { q: "Chase" }).total).toBe(1);

    const changed = ledger.changeEntry(ME, entry.id, {
      kind: "exchanged",
      date: DAY,
      account: brl,
      other: usd,
      amount: 1_000,
      arrived: 180,
    });
    expect(changed.usd).toBe(180);
    expect(account(usd).balance).toBe(180);
    expectEverythingBalances();

    ledger.removeEntry(ME, entry.id);
    expect(account(brl).balance).toBe(0);
    expect(account(usd).balance).toBe(0);
  });

  it("can turn into a plain entry, which has two postings again", () => {
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: brl,
      other: usd,
      amount: 500,
      arrived: 100,
    });
    const changed = ledger.changeEntry(ME, entry.id, {
      kind: "spent",
      date: DAY,
      account: brl,
      other: category("Food"),
      amount: 500,
    });
    expect(changed.arrived).toBeNull();
    expect(account(usd).balance).toBe(0);
    expectEverythingBalances();
  });

  it("refuses the same currency, a missing amount, and a move across currencies", () => {
    const brl = addAccount("Itaú", "BRL");
    const other = addAccount("Caixa", "BRL");
    const usd = addAccount("Chase", "USD");
    const base = { kind: "exchanged" as const, date: DAY, account: brl, amount: 500 };
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), other, arrived: 100 }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), other: usd }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), other: usd, arrived: 0 }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), other: category("Food"), arrived: 100 }))).toBe(
      "invalid",
    );
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "moved", other: usd }))).toBe("invalid");
  });

  it("keeps the hidden account out of the page", () => {
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: brl,
      other: usd,
      amount: 500,
      arrived: 100,
    });
    const book = ledger.load(ME, "2026-10");
    expect(book.accounts.map((a) => a.name).sort()).toEqual(["Chase", "Itaú"]);
    expect(book.categories.map((c) => c.name)).not.toContain("Currency exchange");
  });
});

describe("in another currency", () => {
  it("records a dollar price charged to an account in reais", () => {
    const card = addAccount("Nubank", "BRL", "card");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "spent",
      date: DAY,
      account: card,
      other: category("Fun"),
      amount: 11_500,
      paid: { currency: "USD", amount: 2_000 },
    });
    expect(entry.usd).toBe(2_000);
    expect(entry.rate).toBeNull();
    expect(entry.paid).toEqual({ currency: "USD", amount: 2_000 });
    expect(account(card).balance).toBe(-11_500);
    expectEverythingBalances();
  });

  it("records a price in reais taken from an account in dollars, needing no rate", () => {
    rate = null;
    const usd = addAccount("Chase", "USD");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: DAY,
      account: usd,
      other: category("Salary"),
      amount: 1_850,
      paid: { currency: "BRL", amount: 10_000 },
    });
    expect(entry.usd).toBe(1_850);
    expect(account(usd).balance).toBe(1_850);
    expectEverythingBalances();
  });

  it("works the dollars out again when the price is taken off", () => {
    const card = addAccount("Nubank", "BRL", "card");
    const food = category("Food");
    const base = { kind: "spent" as const, date: DAY, account: card, other: food, amount: 10_000 };
    const entry = ledger.addEntry(ME, { ...base, id: id(), paid: { currency: "USD", amount: 1_900 } });
    const changed = ledger.changeEntry(ME, entry.id, base);
    expect(changed.paid).toBeNull();
    expect(changed.usd).toBe(2_000);
  });

  it("refuses its own currency, and moves", () => {
    const brl = addAccount("Itaú", "BRL");
    const other = addAccount("Caixa", "BRL");
    const base = { date: DAY, account: brl, amount: 100 };
    const paid = (currency: "USD" | "BRL") => ({ currency, amount: 100 });
    expect(
      code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "spent", other: category("Food"), paid: paid("BRL") })),
    ).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "moved", other, paid: paid("USD") }))).toBe(
      "invalid",
    );
  });
});

describe("why what you're worth changed", () => {
  // The rate is 5 until the end of September, when it is 4.
  const fiveThenFour = (date: string): Rate => ({
    currency: "BRL",
    value: date >= "2026-09-30" ? 4 : 5,
    date,
    source: "test",
  });

  it("shows reais becoming worth more dollars as rate changes", () => {
    rateOn = fiveThenFour;
    const brl = addAccount("Itaú", "BRL");
    ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: "2026-08-15",
      account: brl,
      other: category("Salary"),
      amount: 100_000,
    });
    expect(ledger.load(ME, "2026-09").month.change).toEqual({ start: 20_000, end: 25_000, added: 0, rates: 5_000 });
  });

  it("adds up, with money in and out, starting balances and balance checks", () => {
    rateOn = fiveThenFour;
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    const food = category("Food");
    const add = (date: string, kind: "spent" | "received", account: string, other: string, amount: number) =>
      ledger.addEntry(ME, { id: id(), kind, date, account, other, amount });
    add("2026-08-10", "received", brl, category("Salary"), 100_000);
    add("2026-09-10", "received", usd, category("Salary"), 30_000);
    add("2026-09-11", "spent", brl, food, 5_000);
    ledger.checkBalance(ME, usd, { id: id(), date: "2026-09-12", actual: 29_000 });

    const { change, moneyIn, moneyOut } = ledger.load(ME, "2026-09").month;
    expect(moneyIn).toBe(30_000);
    expect(moneyOut).toBe(1_000);
    expect(change!.start).toBe(20_000);
    expect(change!.added).toBe(-1_000);
    // Itaú's R$ 950 at 4, and Chase's $290.
    expect(change!.end).toBe(23_750 + 29_000);
    expect(change!.end).toBe(change!.start + moneyIn - moneyOut + change!.added + change!.rates);
  });

  it("counts what an exchange cost", () => {
    const brl = addAccount("Itaú", "BRL");
    const usd = addAccount("Chase", "USD");
    ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: "2026-08-10",
      account: brl,
      other: category("Salary"),
      amount: 100_000,
    });
    // R$ 1,000 is $200 at the rate, but only $180 arrived.
    ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: "2026-09-10",
      account: brl,
      other: usd,
      amount: 100_000,
      arrived: 18_000,
    });
    expect(ledger.load(ME, "2026-09").month.change).toEqual({ start: 20_000, end: 18_000, added: 0, rates: -2_000 });
  });

  it("gives up rather than guess when a rate it needs is unknown", () => {
    const brl = addAccount("Itaú", "BRL");
    ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: "2026-08-10",
      account: brl,
      other: category("Salary"),
      amount: 100_000,
    });
    rate = null;
    expect(ledger.load(ME, "2026-09").month.change).toBeNull();
  });
});

describe("coins", () => {
  const BTC = 100_000_000;
  const ICP = 100_000_000;
  const USDC = 1_000_000;

  it("keeps crypto accounts and coins together", () => {
    expect(code(() => addAccount("Wrong", "BTC", "bank"))).toBe("invalid");
    expect(code(() => addAccount("Wrong", "USD", "crypto"))).toBe("invalid");
    const wallet = addAccount("Sparrow BTC", "BTC");
    expect(code(() => ledger.changeAccount(ME, wallet, { kind: "savings" }))).toBe("invalid");
    expect(account(wallet).kind).toBe("crypto");
  });

  it("values a coin at the day's price, and that value stays", () => {
    const wallet = addAccount("Coinbase ICP", "ICP");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: DAY,
      account: wallet,
      other: category("Staking rewards"),
      amount: 2 * ICP,
    });
    expect(entry.usd).toBe(2_000);
    expect(entry.rate).toMatchObject({ currency: "ICP", value: 10 });
    prices.ICP = 20;
    expect(ledger.listEntries(ME, {}).entries[0]!.usd).toBe(2_000);
    expect(account(wallet).usdNow).toBe(4_000);
    expectEverythingBalances();
  });

  it("counts coins in what you have", () => {
    addAccount("Coinbase BTC", "BTC", "crypto", BTC / 10);
    addAccount("Coinbase USDC", "USDC", "crypto", 50 * USDC);
    expect(ledger.load(ME, "2026-10").have).toBe(505_000);
  });

  it("asks for the dollars when a coin's price isn't known", () => {
    delete prices.BTC;
    const wallet = addAccount("Sparrow BTC", "BTC");
    const input = {
      id: id(),
      kind: "received" as const,
      date: DAY,
      account: wallet,
      other: category("Gifts"),
      amount: BTC,
    };
    expect(code(() => ledger.addEntry(ME, input))).toBe("no-rate");
    expect(ledger.addEntry(ME, { ...input, usd: 4_000_000 }).usd).toBe(4_000_000);
    expect(ledger.load(ME, "2026-10").missingRate).toBe(true);
  });

  it("takes a typed cost for what you already held, even nothing", () => {
    const wallet = id();
    ledger.addAccount(ME, {
      id: wallet,
      name: "Sparrow BTC",
      kind: "crypto",
      currency: "BTC",
      starting: BTC,
      date: DAY,
      usd: 1_000_000,
    });
    expect(ledger.listEntries(ME, {}).entries[0]!.usd).toBe(1_000_000);
    expect(account(wallet).usdNow).toBe(5_000_000);
    const gift = addAccount("Gifted ICP", "ICP");
    const free = ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: DAY,
      account: gift,
      other: category("Gifts"),
      amount: ICP,
      usd: 0,
    });
    expect(free.usd).toBe(0);
    expectEverythingBalances();
  });

  it("refuses a price in reais or dollars on a coin", () => {
    const wallet = addAccount("Sparrow BTC", "BTC");
    const paid = { currency: "USD" as const, amount: 100 };
    const base = { kind: "spent" as const, date: DAY, account: wallet, other: category("Fun"), amount: 1_000 };
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), paid }))).toBe("invalid");
  });

  it("checks a coin's balance like any other", () => {
    const wallet = addAccount("Sparrow BTC", "BTC", "crypto", BTC);
    const { entry } = ledger.checkBalance(ME, wallet, { id: id(), date: DAY, actual: BTC + 1_000_000 });
    expect(entry!.amount).toBe(1_000_000);
    expect(entry!.usd).toBe(50_000);
    expect(account(wallet).balance).toBe(BTC + 1_000_000);
    expectEverythingBalances();
  });

  it("keeps large ICP amounts exact, and stops a balance before sums stop being safe", () => {
    const wallet = addAccount("Coinbase ICP", "ICP");
    const big = 9_000_000 * ICP + 1;
    const add = (amount: number) =>
      ledger.addEntry(ME, {
        id: id(),
        kind: "received",
        date: DAY,
        account: wallet,
        other: category("Gifts"),
        amount,
        usd: 100,
      });
    add(big);
    add(big);
    expect(account(wallet).balance).toBe(2 * big);
    expect(code(() => add(big + 1_000_000_000_000_000))).toBe("invalid");
    add(big);
    add(big);
    expect(code(() => add(big))).toBe("invalid");
    expect(account(wallet).balance).toBe(4 * big);
  });

  it("refuses a value too large to add up safely", () => {
    const wallet = addAccount("Sparrow BTC", "BTC");
    expect(
      code(() =>
        ledger.addEntry(ME, {
          id: id(),
          kind: "received",
          date: DAY,
          account: wallet,
          other: category("Gifts"),
          amount: 1_000_000 * BTC,
        }),
      ),
    ).toBe("invalid");
    expect(account(wallet).balance).toBe(0);
  });
});

describe("which side values a trade", () => {
  const BTC = 100_000_000;
  const ICP = 100_000_000;
  const USDC = 1_000_000;
  const exchange = (from: Currency, amount: number, to: Currency, arrived: number) => {
    const a = addAccount(`From ${from}`, from);
    const b = addAccount(`To ${to}`, to);
    return ledger.addEntry(ME, { id: id(), kind: "exchanged", date: DAY, account: a, other: b, amount, arrived });
  };

  it.each([
    ["USD beats USDC", "USD", 5_000, "USDC", 51 * USDC, 5_000],
    ["USD beats BRL", "BRL", 50_000, "USD", 9_000, 9_000],
    ["USD beats BTC", "USD", 5_000, "BTC", BTC / 1_000, 5_000],
    ["USDC beats BRL", "BRL", 50_000, "USDC", 90 * USDC, 9_000],
    ["USDC beats BTC", "USDC", 40 * USDC, "BTC", BTC / 1_000, 4_000],
    ["USDC beats ICP", "USDC", 50 * USDC, "ICP", 20 * ICP, 5_000],
    ["BRL beats BTC", "BRL", 50_000, "BTC", BTC / 1_000, 10_000],
    ["BRL beats ICP", "ICP", 2 * ICP, "BRL", 50_000, 10_000],
    ["BTC beats ICP", "BTC", BTC / 1_000, "ICP", 20 * ICP, 5_000],
    ["and the other way", "ICP", 20 * ICP, "BTC", BTC / 1_000, 5_000],
  ] as const)("%s", (_name, from, amount, to, arrived, usd) => {
    expect(exchange(from, amount, to, arrived).usd).toBe(usd);
    expectEverythingBalances();
  });

  it("says which price it used", () => {
    expect(exchange("BTC", BTC / 1_000, "ICP", 20 * ICP).rate).toMatchObject({ currency: "BTC", value: 50_000 });
  });

  it("takes typed dollars instead, and asks for them when the price isn't known", () => {
    delete prices.BTC;
    const a = addAccount("Coinbase BTC", "BTC");
    const b = addAccount("Coinbase ICP", "ICP");
    const input = {
      id: id(),
      kind: "exchanged" as const,
      date: DAY,
      account: a,
      other: b,
      amount: BTC / 1_000,
      arrived: 20 * ICP,
    };
    expect(code(() => ledger.addEntry(ME, input))).toBe("no-rate");
    expect(ledger.addEntry(ME, { ...input, usd: 4_900 }).usd).toBe(4_900);
  });

  it("keeps its dollars when only the note changes, even if the price has moved", () => {
    const entry = exchange("BTC", BTC / 1_000, "ICP", 20 * ICP);
    prices.BTC = 99_000;
    const changed = ledger.changeEntry(ME, entry.id, {
      kind: "exchanged",
      date: DAY,
      account: entry.account,
      other: entry.other!,
      amount: entry.amount,
      arrived: 20 * ICP,
      memo: "Note",
    });
    expect(changed.memo).toBe("Note");
    expect(changed.usd).toBe(5_000);
  });
});

describe("fees", () => {
  const BTC = 100_000_000;

  it("takes a trade's fee out of what left, as spending, and not out of what the coin cost", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 100_000);
    const wallet = addAccount("Coinbase BTC", "BTC");
    // R$ 425 left, R$ 5 of it the fee, and the rate is 5.
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: bank,
      other: wallet,
      amount: 42_500,
      arrived: BTC / 1_000,
      fee: 500,
    });
    expect(account(bank).balance).toBe(57_500);
    expect(account(wallet).balance).toBe(BTC / 1_000);
    expect(entry.fee).toEqual({ currency: "BRL", amount: 500, usd: 100 });
    expect(entry.usd).toBe(8_500);
    expect(entry.arrived).toEqual({ currency: "BTC", amount: BTC / 1_000 });
    const { month } = ledger.load(ME, "2026-10");
    expect(month.moneyOut).toBe(100);
    expect(month.spending).toEqual([{ category: category("Fees"), usd: 100 }]);
    const arrivedUsd = db.prepare("SELECT usd FROM postings WHERE tx_id = ? AND seq = 3").get(entry.id) as {
      usd: number;
    };
    expect(arrivedUsd.usd).toBe(8_400);
    expectEverythingBalances();
  });

  it("records a network fee on a move: less arrives, and the rest is spending", () => {
    const from = addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    const to = addAccount("Sparrow BTC", "BTC");
    const entry = ledger.addEntry(ME, {
      id: id(),
      kind: "moved",
      date: DAY,
      account: from,
      other: to,
      amount: BTC / 100,
      fee: BTC / 10_000,
    });
    expect(account(from).balance).toBe(BTC - BTC / 100);
    expect(account(to).balance).toBe(BTC / 100 - BTC / 10_000);
    expect(entry.usd).toBe(50_000);
    expect(entry.fee).toEqual({ currency: "BTC", amount: BTC / 10_000, usd: 500 });
    expect(entry.other).toBe(to);
    expect(ledger.load(ME, "2026-10").month.moneyOut).toBe(500);
    expectEverythingBalances();
  });

  it("works on a move in reais or dollars too", () => {
    const from = addAccount("Itaú", "BRL", "bank", 10_000);
    const to = addAccount("Caixa", "BRL");
    ledger.addEntry(ME, { id: id(), kind: "moved", date: DAY, account: from, other: to, amount: 1_000, fee: 100 });
    expect(account(to).balance).toBe(900);
    expectEverythingBalances();
  });

  it("can be changed and removed, and an entry without one reads as before", () => {
    const from = addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    const to = addAccount("Sparrow BTC", "BTC");
    const base = { kind: "moved" as const, date: DAY, account: from, other: to, amount: BTC / 100 };
    const entry = ledger.addEntry(ME, { ...base, id: id(), fee: 1_000 });
    const removed = ledger.changeEntry(ME, entry.id, base);
    expect(removed.fee).toBeNull();
    expect(account(to).balance).toBe(BTC / 100);
    expectEverythingBalances();
  });

  it("refuses a fee that isn't one", () => {
    const from = addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    const to = addAccount("Sparrow BTC", "BTC");
    const base = { kind: "moved" as const, date: DAY, account: from, other: to, amount: 1_000 };
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), fee: 1_000 }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), fee: -1 }))).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "spent", other: category("Fun"), fee: 10 }))).toBe(
      "invalid",
    );
  });

  it("makes the category again if it was deleted", () => {
    ledger.load(ME, "2026-10");
    ledger.removeAccount(ME, category("Fees"));
    const from = addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    const to = addAccount("Sparrow BTC", "BTC");
    ledger.addEntry(ME, { id: id(), kind: "moved", date: DAY, account: from, other: to, amount: 1_000, fee: 10 });
    expect(ledger.load(ME, "2026-10").categories.map((c) => c.name)).toContain("Fees");
  });
});

describe("what you're worth, with coins", () => {
  it("shows a coin's price moving as the same line as exchange rates", () => {
    btcOn = (date) => (date >= "2026-09-30" ? 60_000 : 50_000);
    const wallet = addAccount("Sparrow BTC", "BTC");
    ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: "2026-08-15",
      account: wallet,
      other: category("Gifts"),
      amount: 100_000_000,
    });
    expect(ledger.load(ME, "2026-09").month.change).toEqual({
      start: 5_000_000,
      end: 6_000_000,
      added: 0,
      rates: 1_000_000,
    });
  });
});

describe("holdings", () => {
  const BTC = 100_000_000;

  it("lists nothing until there is a coin to list", () => {
    addAccount("Itaú", "BRL");
    expect(ledger.holdings(ME).holdings).toEqual([]);
  });

  it("lists a coin once it has an account, even an empty one", () => {
    addAccount("Coinbase ICP", "ICP");
    expect(ledger.holdings(ME).holdings).toMatchObject([{ coin: "ICP", quantity: 0, cost: 0, value: 0 }]);
  });

  it("follows a coin from buying it to moving it, with its cost unchanged by the move", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 10_000_000);
    const coinbase = addAccount("Coinbase BTC", "BTC");
    const sparrow = addAccount("Sparrow BTC", "BTC");
    // 0.1 BTC for R$ 25,000 at a rate of 5: $5,000, plus a fee of R$ 50 that isn't part of its cost.
    ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: bank,
      other: coinbase,
      amount: 2_505_000,
      arrived: BTC / 10,
      fee: 5_000,
    });
    expect(ledger.holdings(ME).holdings[0]).toMatchObject({ quantity: BTC / 10, cost: 500_000, realized: 0 });

    // All of it moves, with no fee.
    ledger.addEntry(ME, { id: id(), kind: "moved", date: DAY, account: coinbase, other: sparrow, amount: BTC / 10 });
    const [moved] = ledger.holdings(ME).holdings;
    expect(moved).toMatchObject({ quantity: BTC / 10, cost: 500_000, realized: 0, short: false });
    expect(moved!.accounts).toEqual([
      { id: coinbase, name: "Coinbase BTC", balance: 0 },
      { id: sparrow, name: "Sparrow BTC", balance: BTC / 10 },
    ]);

    // The price has gone up, so half of it sells at a gain.
    prices.BTC = 80_000;
    expect(ledger.holdings(ME).holdings[0]).toMatchObject({ value: 800_000, price: { value: 80_000 } });
    ledger.addEntry(ME, {
      id: id(),
      kind: "exchanged",
      date: DAY,
      account: sparrow,
      other: bank,
      amount: BTC / 20,
      arrived: 2_000_000,
    });
    expect(ledger.holdings(ME).holdings[0]).toMatchObject({
      quantity: BTC / 20,
      cost: 250_000,
      realized: 150_000,
      value: 400_000,
    });
    expectEverythingBalances();
  });

  it("takes a network fee out as a small sale, leaving the average alone", () => {
    const coinbase = addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    const sparrow = addAccount("Sparrow BTC", "BTC");
    ledger.addEntry(ME, {
      id: id(),
      kind: "moved",
      date: DAY,
      account: coinbase,
      other: sparrow,
      amount: BTC / 10,
      fee: BTC / 1_000,
    });
    const [held] = ledger.holdings(ME).holdings;
    expect(held!.quantity).toBe(BTC - BTC / 1_000);
    expect(held!.cost).toBe(4_995_000);
    expect(held!.realized).toBe(0);
  });

  it("adds a staking reward at the day's value", () => {
    const wallet = addAccount("Coinbase ICP", "ICP");
    ledger.addEntry(ME, {
      id: id(),
      kind: "received",
      date: DAY,
      account: wallet,
      other: category("Staking rewards"),
      amount: 5 * BTC,
    });
    expect(ledger.holdings(ME).holdings[0]).toMatchObject({ coin: "ICP", cost: 5_000, value: 5_000 });
    expect(ledger.load(ME, "2026-10").month.moneyIn).toBe(5_000);
  });

  it("orders by date, so an entry typed late still counts in its place", () => {
    const wallet = addAccount("Coinbase BTC", "BTC");
    const bank = addAccount("Chase", "USD", "bank", 100_000_000);
    const trade = (date: string, kind: "buy" | "sell", usd: number) =>
      ledger.addEntry(ME, {
        id: id(),
        kind: "exchanged",
        date,
        account: kind === "buy" ? bank : wallet,
        other: kind === "buy" ? wallet : bank,
        amount: kind === "buy" ? usd : BTC,
        arrived: kind === "buy" ? BTC : usd,
      });
    trade("2026-09-20", "sell", 6_000_000);
    trade("2026-09-10", "buy", 5_000_000);
    expect(ledger.holdings(ME).holdings[0]).toMatchObject({ quantity: 0, realized: 1_000_000, short: false });
  });

  it("shows no value while the price isn't known, but still what it cost", () => {
    addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    delete prices.BTC;
    expect(ledger.holdings(ME).holdings[0]).toMatchObject({ value: null, cost: 5_000_000, price: null });
  });

  it("keeps each user's coins apart", () => {
    addAccount("Coinbase BTC", "BTC", "crypto", BTC);
    expect(ledger.holdings("freya").holdings).toEqual([]);
  });
});

describe("loan accounts", () => {
  it("start at what is owed, the right way round", () => {
    expect(code(() => addAccount("Caixa", "BRL", "borrowed", 100))).toBe("invalid");
    expect(code(() => addAccount("Bruno", "BRL", "lent", -100))).toBe("invalid");
    const caixa = addAccount("Caixa", "BRL", "borrowed", -50_000);
    const bruno = addAccount("Bruno", "USD", "lent", 20_000);
    expect(account(caixa).balance).toBe(-50_000);
    expect(account(bruno).balance).toBe(20_000);
    const book = ledger.load(ME, "2026-10");
    expect(book.owe).toBe(10_000);
    expect(book.have).toBe(20_000);
    expectEverythingBalances();
  });

  it("can't hold a coin, or stop being a loan", () => {
    expect(code(() => addAccount("Coin loan", "BTC", "borrowed"))).toBe("invalid");
    const caixa = addAccount("Caixa", "BRL", "borrowed");
    expect(code(() => ledger.changeAccount(ME, caixa, { kind: "lent" }))).toBe("invalid");
    expect(code(() => ledger.changeAccount(ME, caixa, { kind: "bank" }))).toBe("invalid");
    const bank = addAccount("Itaú", "BRL");
    expect(code(() => ledger.changeAccount(ME, bank, { kind: "borrowed" }))).toBe("invalid");
    expect(code(() => ledger.changeAccount(ME, caixa, { name: "Caixa car loan", kind: "borrowed" }))).toBe("accepted");
  });

  it("refuse spending, income and exchanges, which aren't what happens to a loan", () => {
    const caixa = addAccount("Caixa", "BRL", "borrowed");
    const bruno = addAccount("Bruno", "BRL", "lent");
    const usd = addAccount("Chase", "USD");
    const base = { date: DAY, amount: 100 };
    expect(
      code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "spent", account: caixa, other: category("Fun") })),
    ).toBe("invalid");
    expect(
      code(() =>
        ledger.addEntry(ME, { ...base, id: id(), kind: "received", account: bruno, other: category("Gifts") }),
      ),
    ).toBe("invalid");
    expect(
      code(() =>
        ledger.addEntry(ME, { ...base, id: id(), kind: "exchanged", account: caixa, other: usd, arrived: 100 }),
      ),
    ).toBe("invalid");
    expect(code(() => ledger.addEntry(ME, { ...base, id: id(), kind: "moved", account: caixa, other: bruno }))).toBe(
      "invalid",
    );
  });

  it("taking one out moves money without changing what you're worth", () => {
    const bank = addAccount("Itaú", "BRL");
    const caixa = addAccount("Caixa", "BRL", "borrowed");
    const bruno = addAccount("Bruno", "BRL", "lent");
    const worth = () => {
      const { have, owe } = ledger.load(ME, "2026-10");
      return have - owe;
    };
    ledger.addEntry(ME, { id: id(), kind: "moved", date: DAY, account: caixa, other: bank, amount: 1_000_000 });
    expect(account(bank).balance).toBe(1_000_000);
    expect(account(caixa).balance).toBe(-1_000_000);
    expect(worth()).toBe(0);
    ledger.addEntry(ME, { id: id(), kind: "moved", date: DAY, account: bank, other: bruno, amount: 300_000 });
    expect(account(bruno).balance).toBe(300_000);
    expect(worth()).toBe(0);
    expect(ledger.load(ME, "2026-10").month.moneyOut).toBe(0);
    expectEverythingBalances();
  });

  it("a fee on taking one out is what it costs", () => {
    const bank = addAccount("Itaú", "BRL");
    const caixa = addAccount("Caixa", "BRL", "borrowed");
    // R$ 10,000 borrowed, R$ 9,800 arrives, and the rate is 5.
    ledger.addEntry(ME, {
      id: id(),
      kind: "moved",
      date: DAY,
      account: caixa,
      other: bank,
      amount: 1_000_000,
      fee: 20_000,
    });
    expect(account(caixa).balance).toBe(-1_000_000);
    expect(account(bank).balance).toBe(980_000);
    const { have, owe, month } = ledger.load(ME, "2026-10");
    expect(have - owe).toBe(-4_000);
    expect(month.moneyOut).toBe(4_000);
    expectEverythingBalances();
  });

  it("are checked and closed like any account", () => {
    const caixa = addAccount("Caixa", "BRL", "borrowed", -50_000);
    expect(code(() => ledger.changeAccount(ME, caixa, { closed: true }))).toBe("conflict");
    ledger.checkBalance(ME, caixa, { id: id(), date: DAY, actual: 0 });
    ledger.changeAccount(ME, caixa, { closed: true });
    expect(account(caixa).closed).toBe(true);
    expectEverythingBalances();
  });

  it("move with the rate on the month's line, like any balance in reais", () => {
    rateOn = (date) => ({ currency: "BRL", value: date >= "2026-09-30" ? 4 : 5, date, source: "test" });
    const caixa = id();
    ledger.addAccount(ME, {
      id: caixa,
      name: "Caixa",
      kind: "borrowed",
      currency: "BRL",
      starting: -100_000,
      date: "2026-08-10",
    });
    // R$ 1,000 owed was $200 and is now $250: the debt has grown in dollars.
    expect(ledger.load(ME, "2026-09").month.change).toEqual({ start: -20_000, end: -25_000, added: 0, rates: -5_000 });
  });
});

describe("the upgrade to coins", () => {
  it("adds the two categories and leaves what was there alone", () => {
    const old = new DatabaseSync(":memory:");
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, 2);
    const at = "2026-10-01T00:00:00Z";
    const add = old.prepare(
      "INSERT INTO accounts (id, owner, name, kind, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    old.prepare("INSERT INTO books (owner, created_at) VALUES ('odin', ?), ('freya', ?)").run(at, at);
    for (const owner of ["odin", "freya"]) {
      add.run(`starting-${owner}`, owner, "Starting balance", "starting", null, at, at);
      add.run(`adjust-${owner}`, owner, "Balance check", "adjustment", null, at, at);
      add.run(`exchange-${owner}`, owner, "Currency exchange", "exchange", null, at, at);
      add.run(`food-${owner}`, owner, "Food", "expense", null, at, at);
    }
    // Freya already has a category called that.
    add.run("fees-freya", "freya", "FEES", "expense", null, at, at);
    add.run("bank-odin", "odin", "Itaú", "bank", "BRL", at, at);
    old
      .prepare(
        `
      INSERT INTO transactions (id, owner, kind, date, rate, rate_date, rate_source, created_at, updated_at)
      VALUES ('old-entry-1', 'odin', 'spent', '2026-10-05', 5, '2026-10-05', 'Banco Central (PTAX)', ?, ?)
    `,
      )
      .run(at, at);
    const post = old.prepare(
      "INSERT INTO postings (tx_id, seq, account_id, currency, amount, usd) VALUES (?, ?, ?, ?, ?, ?)",
    );
    post.run("old-entry-1", 0, "bank-odin", "BRL", -10_000, -2_000);
    post.run("old-entry-1", 1, "food-odin", "BRL", 10_000, 2_000);

    migrate(old);

    const ledgerNow = createLedger(old, () => null);
    const names = (owner: string) => ledgerNow.load(owner, "2026-10").categories.map((c) => c.name);
    expect(names("odin")).toEqual(expect.arrayContaining(["Fees", "Food", "Staking rewards"]));
    expect(names("freya").filter((n) => n.toLowerCase() === "fees")).toEqual(["FEES"]);
    expect(names("freya")).toContain("Interest paid");
    const [entry] = ledgerNow.listEntries("odin", {}).entries;
    expect(entry).toMatchObject({
      amount: 10_000,
      usd: 2_000,
      fee: null,
      rate: { currency: "BRL", value: 5, source: "Banco Central (PTAX)" },
    });
  });
});

describe("Check balance", () => {
  it("records the difference, either way, on that day's balance", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 10_000);
    const lower = ledger.checkBalance(ME, bank, { id: id(), date: DAY, actual: 9_000 });
    expect(lower.recorded).toBe(10_000);
    expect(lower.entry!.amount).toBe(-1_000);
    expect(lower.entry!.usd).toBe(-200);
    expect(account(bank).balance).toBe(9_000);

    const higher = ledger.checkBalance(ME, bank, { id: id(), date: DAY, actual: 9_500 });
    expect(higher.entry!.amount).toBe(500);
    expect(account(bank).balance).toBe(9_500);
    expectEverythingBalances();
  });

  it("adds nothing when it matches", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 10_000);
    expect(ledger.checkBalance(ME, bank, { id: id(), date: DAY, actual: 10_000 }).entry).toBeNull();
    expect(ledger.listEntries(ME, {}).total).toBe(1);
  });

  it("applies once when sent twice, and can only be deleted afterwards", () => {
    const bank = addAccount("Itaú", "BRL", "bank", 10_000);
    const input = { id: id(), date: DAY, actual: 9_000 };
    const first = ledger.checkBalance(ME, bank, input);
    const again = ledger.checkBalance(ME, bank, input);
    expect(again.entry!.id).toBe(first.entry!.id);
    expect(account(bank).balance).toBe(9_000);
    expect(
      code(() => ledger.changeEntry(ME, first.entry!.id, { kind: "spent", date: DAY, account: bank, amount: 1 })),
    ).toBe("conflict");
    ledger.removeEntry(ME, first.entry!.id);
    expect(account(bank).balance).toBe(10_000);
  });
});

describe("double entry", () => {
  it("refuses to write a transaction that doesn't add up", () => {
    const leg = (currency: "USD" | "BRL", amount: number, usd: number) => ({ account: "a", currency, amount, usd });
    expect(() => assertBalanced([leg("BRL", 100, 20), leg("BRL", -99, -20)])).toThrow(/BRL adds up/);
    expect(() => assertBalanced([leg("BRL", 100, 20), leg("BRL", -100, -19)])).toThrow(/USD value/);
    expect(() => assertBalanced([leg("USD", 100, 100), leg("BRL", -100, -100)])).toThrow(/adds up/);
    expect(() => assertBalanced([leg("BRL", 100, 20), leg("BRL", -100, -20)])).not.toThrow();
  });
});

describe("removed users", () => {
  it("lose their books; others and the rates stay", () => {
    addAccount("Itaú", "BRL", "bank", 100);
    ledger.load("freya", "2026-10");
    db.prepare(
      "INSERT INTO rates (date, base, quote, value, source, fetched_at) VALUES (?, 'USD', 'BRL', 5, 'test', 'now')",
    ).run(today());
    expect(ledger.removeUnknownOwners(new Set(["freya"]))).toEqual([{ owner: ME, entries: 1 }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner = ?").get(ME)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM postings").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM rates").get()).toEqual({ n: 1 });
    expect(ledger.load("freya", "2026-10").categories.length).toBeGreaterThan(0);
  });
});

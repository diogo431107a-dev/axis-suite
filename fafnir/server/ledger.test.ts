import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.ts";
import { createLedger, assertBalanced, type Ledger } from "./ledger.ts";
import { StoreError } from "./errors.ts";
import { today } from "./rates.ts";
import type { Rate } from "../shared/protocol.ts";

const RATE: Rate = { value: 5, date: "2026-10-01", source: "test" };
const ME = "odin";
const DAY = "2026-10-05";

let db: DatabaseSync;
let rate: Rate | null;
/** When set, the rate of each day instead of `rate`. */
let rateOn: ((date: string) => Rate | null) | null;
let ledger: Ledger;
let nextId = 0;
const id = () => `id-00000-${++nextId}`;

const category = (name: string, owner = ME) => {
  const found = ledger.load(owner, "2026-10").categories.find((c) => c.name === name);
  if (!found) throw new Error(`No category ${name}`);
  return found.id;
};

function addAccount(name: string, currency: "USD" | "BRL", kind: "bank" | "card" = "bank", starting = 0): string {
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
  ledger = createLedger(db, (date) => (rateOn ? rateOn(date) : rate));
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
  const fiveThenFour = (date: string): Rate => ({ value: date >= "2026-09-30" ? 4 : 5, date, source: "test" });

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

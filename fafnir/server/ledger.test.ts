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
  ledger = createLedger(db, () => rate);
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

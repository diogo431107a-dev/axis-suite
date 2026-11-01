import { describe, expect, it } from "vitest";
import { addMonths, localDate, money, parseAmount, plainAmount, showDate, showMonth } from "./format.ts";

describe("parseAmount", () => {
  it.each([
    ["100", 10_000],
    ["18.45", 1_845],
    ["18,45", 1_845],
    ["18.5", 1_850],
    ["1,234.56", 123_456],
    ["1.234,56", 123_456],
    ["1,234", 123_400],
    ["1.234", 123_400],
    ["1.234.567", 123_456_700],
    ["R$ 1.234,56", 123_456],
    ["$ 20", 2_000],
    ["-20", -2_000],
    ["−20,50", -2_050],
    ["0", 0],
    // In cents exactly: 1.1 * 100 isn't 110 in floating point.
    ["1.10", 110],
    ["4.35", 435],
  ])("reads %s", (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it.each(["", "abc", "10.", "1.2.3", "1,23,45", "12,3456", "1e5", "--5", "5-"])("refuses %j", (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe("parseAmount in a coin", () => {
  it.each([
    ["0,005", "BTC", 500_000],
    ["0.005", "BTC", 500_000],
    ["1.234", "BTC", 123_400_000],
    ["1,234", "BTC", 123_400_000],
    ["1,234.5", "BTC", 123_450_000_000],
    ["1.234,5", "BTC", 123_450_000_000],
    ["1,234,567", "ICP", 123_456_700_000_000],
    ["0.00000001", "BTC", 1],
    ["0.12345678", "ICP", 12_345_678],
    ["50", "USDC", 50_000_000],
    ["1.5", "USDC", 1_500_000],
    ["0.000001", "USDC", 1],
    ["0.005 BTC", "BTC", 500_000],
    ["-0,5", "ICP", -50_000_000],
    // What an edit form starts from has to read back as itself.
    ["1,234.50000000", "BTC", 123_450_000_000],
  ] as const)("reads %s %s", (text, currency, amount) => {
    expect(parseAmount(text, currency)).toBe(amount);
  });

  it.each([
    ["0.000000001", "BTC"],
    ["0.0000001", "USDC"],
    ["1.", "BTC"],
    ["1.2.3", "BTC"],
    ["99999999999", "BTC"],
  ] as const)("refuses %s %s", (text, currency) => {
    expect(parseAmount(text, currency)).toBeNull();
  });

  it("keeps the rule for reais and dollars", () => {
    expect(parseAmount("1.234", "BRL")).toBe(123_400);
    expect(parseAmount("1,234", "USD")).toBe(123_400);
    expect(parseAmount("1,5", "BRL")).toBe(150);
  });
});

describe("showing money", () => {
  it("shows coins with their name and all the digits that matter", () => {
    expect(money(500_000, "BTC")).toBe("0.00500000 BTC");
    expect(money(123_456_789_012, "BTC")).toBe("1,234.56789012 BTC");
    expect(money(-50_000_000, "ICP")).toBe("−0.5000 ICP");
    expect(money(12_345_678, "ICP")).toBe("0.12345678 ICP");
    expect(money(50_000_000, "USDC")).toBe("50.00 USDC");
    expect(money(1, "USDC")).toBe("0.000001 USDC");
  });

  it("is exact where a fraction wouldn't be", () => {
    expect(plainAmount(2_100_000_000_000_001, "BTC")).toBe("21,000,000.00000001");
    expect(parseAmount(plainAmount(2_100_000_000_000_001, "BTC"), "BTC")).toBe(2_100_000_000_000_001);
  });

  it("keeps the sign outside the symbol", () => {
    expect(money(123_456)).toBe("$1,234.56");
    expect(money(-5, "BRL")).toBe("−R$ 0.05");
  });
});

describe("dates", () => {
  it("shows them without moving a day", () => {
    expect(showDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(showMonth("2026-12")).toBe("December 2026");
  });

  it("uses the local day", () => {
    expect(localDate(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
  });

  it("steps months across years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });
});

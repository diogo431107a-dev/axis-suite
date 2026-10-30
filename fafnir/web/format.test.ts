import { describe, expect, it } from "vitest";
import { addMonths, localDate, money, parseAmount, showDate, showMonth } from "./format.ts";

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

describe("showing money", () => {
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

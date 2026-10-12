import { describe, expect, it } from "vitest";
import type { DaySummary } from "../../shared/protocol.ts";
import { promptFor } from "../prompts/prompts.ts";
import { dayMood, monthGrid, resolveWeekStart } from "./calendar.ts";

describe("monthGrid", () => {
  it("starts weeks on Monday", () => {
    const weeks = monthGrid("2026-10-12", 1);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]![0]).toBe("2026-09-28");
    expect(weeks.at(-1)![6]).toBe("2026-11-01");
  });
  it("starts weeks on Sunday", () => {
    const weeks = monthGrid("2026-10-01", 0);
    expect(weeks[0]![0]).toBe("2026-09-27");
    expect(weeks.at(-1)![6]).toBe("2026-10-31");
  });
  it("has six weeks when the month needs them", () => {
    // August 2026 starts on a Saturday and has 31 days.
    expect(monthGrid("2026-08-01", 1)).toHaveLength(6);
    expect(monthGrid("2026-08-01", 6)).toHaveLength(5);
  });
  it("is whole weeks of consecutive days", () => {
    const days = monthGrid("2024-02-10", 1).flat();
    expect(days).toContain("2024-02-29");
    expect(days.length % 7).toBe(0);
  });
});

describe("week start", () => {
  it("prefers the setting", () => {
    expect(resolveWeekStart(6, "en-US")).toBe(6);
  });
  it("falls back to Monday for an unknown language", () => {
    expect(resolveWeekStart(null, "xx-invalid-!!")).toBe(1);
  });
});

describe("dayMood", () => {
  const page = (mood: DaySummary["mood"]): DaySummary => ({
    journalId: "j",
    date: "d",
    mood,
    words: 0,
    tags: [],
    preview: "",
  });
  it("averages the moods of a day's pages", () => {
    expect(dayMood([page(5), page(2), page(null)])).toBe(4);
    expect(dayMood([page(null)])).toBeNull();
    expect(dayMood(undefined)).toBeNull();
  });
});

describe("prompts", () => {
  const prompts = ["a", "b", "c", "d"];
  it("gives a day the same prompt every time, and others with Another", () => {
    expect(promptFor("2026-10-12", prompts)).toBe(promptFor("2026-10-12", prompts));
    const seen = new Set([0, 1, 2, 3].map((skip) => promptFor("2026-10-12", prompts, skip)));
    expect(seen.size).toBe(4);
  });
  it("gives different days different prompts", () => {
    const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
    expect(new Set(days.map((d) => promptFor(d, prompts))).size).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/protocol.ts";
import { newNode } from "../model/store.ts";
import { dateLabel, localDate, nextDay } from "../text/dates.ts";
import { matches } from "./match.ts";
import { normalize, parseQuery } from "./query.ts";

const node = (content: string, extra: Partial<Node> = {}): Node => ({ ...newNode("n", null, "a0"), content, ...extra });
const TODAY = "2026-10-11";
const find = (query: string, n: Node) => matches(n, parseQuery(query), TODAY);

describe("parseQuery", () => {
  it("reads words, phrases, negations and operators", () => {
    expect(
      parseQuery('Café -tea "big plan" #Work @freya is:completed -has:note date:overdue before:2026-12-01'),
    ).toEqual([
      { kind: "word", value: "cafe", negate: false },
      { kind: "word", value: "tea", negate: true },
      { kind: "phrase", value: "big plan", negate: false },
      { kind: "tag", value: "work", negate: false },
      { kind: "mention", value: "freya", negate: false },
      { kind: "is", value: "completed", negate: false },
      { kind: "has", value: "note", negate: true },
      { kind: "date", value: "overdue", negate: false },
      { kind: "before", value: "2026-12-01", negate: false },
    ]);
  });

  it("treats unknown operators and lone symbols as words, and copes with an open quote", () => {
    expect(parseQuery("foo:bar # before:soon")).toEqual([
      { kind: "word", value: "foo:bar", negate: false },
      { kind: "word", value: "#", negate: false },
      { kind: "word", value: "before:soon", negate: false },
    ]);
    expect(parseQuery('"half open')).toEqual([{ kind: "phrase", value: "half open", negate: false }]);
    expect(parseQuery("   ")).toEqual([]);
  });

  it("normalizes case and accents", () => {
    expect(normalize("Ångström ÉTÉ")).toBe("angstrom ete");
  });
});

describe("matches", () => {
  it("needs every word, in the text or the note, ignoring case and accents", () => {
    expect(find("cafe plan", node("The CAFÉ", { note: "a plan" }))).toBe(true);
    expect(find("cafe tea", node("The café"))).toBe(false);
    expect(find("cafe -plan", node("The café", { note: "a plan" }))).toBe(false);
  });

  it("matches exact phrases", () => {
    expect(find('"big plan"', node("a big plan"))).toBe(true);
    expect(find('"big plan"', node("plan big"))).toBe(false);
  });

  it("matches tags (with their sub-tags) and mentions", () => {
    expect(find("#work", node("call #Work/Q4"))).toBe(true);
    expect(find("#wor", node("call #work"))).toBe(false);
    expect(find("@freya", node("ask @Freya"))).toBe(true);
    expect(find("#work", node("no tags", { note: "but #work here" }))).toBe(true);
  });

  it("checks completion, notes and dates", () => {
    expect(find("is:completed", node("x", { completedAt: "2026-10-01T00:00:00Z" }))).toBe(true);
    expect(find("-is:completed", node("x"))).toBe(true);
    expect(find("has:note", node("x", { note: "n" }))).toBe(true);
    expect(find("has:date", node("x !(2026-10-11)"))).toBe(true);
    expect(find("date:today", node("x !(2026-10-11 09:00)"))).toBe(true);
    expect(find("date:tomorrow", node("x !(2026-10-12)"))).toBe(true);
    expect(find("date:overdue", node("x !(2026-10-10)"))).toBe(true);
    expect(find("date:overdue", node("x !(2026-10-10)", { completedAt: "2026-10-10T00:00:00Z" }))).toBe(false);
    expect(find("before:2026-10-11", node("x !(2026-10-10)"))).toBe(true);
    expect(find("after:2026-10-11", node("x !(2026-10-10)"))).toBe(false);
  });
});

describe("dates", () => {
  it("knows the next day across months and years", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(localDate(new Date(2026, 9, 11, 23, 59))).toBe("2026-10-11");
  });

  it("labels dates relative to today", () => {
    expect(dateLabel("2026-10-11", TODAY)).toBe("Today");
    expect(dateLabel("2026-10-12", TODAY)).toBe("Tomorrow");
    expect(dateLabel("2026-10-10", TODAY)).toBe("Yesterday");
    expect(dateLabel("2026-10-14", TODAY)).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2026, 9, 14)),
    );
    expect(dateLabel("2027-03-01", TODAY)).toContain("2027");
  });
});

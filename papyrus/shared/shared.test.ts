import { describe, expect, it } from "vitest";
import { addDays, addMonths, anniversaryDays, daysBetween, isDate, today, weekday } from "./dates.ts";
import { parseQuery } from "./query.ts";
import { tagsOf } from "./tags.ts";
import { countWords, normalize, normalizeWithMap, preview } from "./words.ts";

describe("dates", () => {
  it.each(["2026-10-12", "2024-02-29", "1000-01-01", "9999-12-31"])("accepts %s", (d) => {
    expect(isDate(d)).toBe(true);
  });
  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-1", "0099-01-01", "2026-10-12T00:00", "", 20261012])(
    "refuses %s",
    (d) => {
      expect(isDate(d)).toBe(false);
    },
  );
  it("adds days across months, years and daylight saving changes", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(daysBetween("2025-12-31", "2026-03-01")).toBe(60);
  });
  it("adds months from the first of the month", () => {
    expect(addMonths("2026-10-12", 3)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(addMonths("2026-03-15", -14)).toBe("2025-01-01");
  });
  it("knows the weekday", () => {
    expect(weekday("2026-10-12")).toBe(1);
    expect(weekday("2026-10-11")).toBe(0);
  });
  it("takes today from the local clock", () => {
    expect(today(new Date(2026, 9, 12, 23, 59))).toBe("2026-10-12");
  });
  it("shows Feb 29 pages on Feb 28 of years without one", () => {
    expect(anniversaryDays("2026-10-12")).toEqual(["10-12"]);
    expect(anniversaryDays("2026-02-28")).toEqual(["02-28", "02-29"]);
    expect(anniversaryDays("2028-02-28")).toEqual(["02-28"]);
    expect(anniversaryDays("2028-02-29")).toEqual(["02-29"]);
  });
});

describe("tags", () => {
  it("finds tags with accents, digits, sub-tags and hyphens", () => {
    expect(tagsOf("Hoje #Família e #work/q4, #well-being. #tired.Then #2026 #a_b")).toEqual([
      "família",
      "work/q4",
      "well-being",
      "tired",
      "a_b",
    ]);
  });
  it("ignores what only looks like a tag", () => {
    expect(tagsOf("C# issue#4 &#123; # heading page#frag ##x a/#b")).toEqual([]);
    expect(tagsOf("see https://example.com/#section and www.example.com/#top")).toEqual([]);
  });
  it("keeps each tag once, in lower case", () => {
    expect(tagsOf("#Work #work #WORK")).toEqual(["work"]);
  });
  it("finds a tag at the start of a line", () => {
    expect(tagsOf("first\n#second")).toEqual(["second"]);
  });
});

describe("words", () => {
  it("normalizes case and accents, and maps back to the original", () => {
    const { text, map } = normalizeWithMap("Café Été");
    expect(text).toBe("cafe ete");
    expect(map).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(normalize("ÀÉÎÕÜ ç ß")).toBe("aeiou c ß");
  });
  it("maps characters that take two code units", () => {
    const { text, map } = normalizeWithMap("a😀b");
    expect(text).toBe("a😀b");
    expect(map).toEqual([0, 1, 1, 3, 4]);
  });
  it("counts words in any language", () => {
    expect(countWords("Hello, world! It's 2026.")).toBe(4);
    expect(countWords("Olá, coração")).toBe(2);
    expect(countWords("   ")).toBe(0);
  });
  it("makes one-line previews", () => {
    expect(preview("one\n\ntwo   three", 50)).toBe("one two three");
    expect(preview("alpha beta gamma delta", 15)).toBe("alpha beta…");
  });
});

describe("parseQuery", () => {
  it("reads words, phrases, negations and operators", () => {
    expect(parseQuery('Café -tea "Big Plan" #Work mood:>=4 -mood:2 before:2026-12-01 after:2025-01-01')).toEqual([
      { kind: "word", value: "cafe", negate: false },
      { kind: "word", value: "tea", negate: true },
      { kind: "phrase", value: "big plan", negate: false },
      { kind: "tag", value: "work", negate: false },
      { kind: "mood", op: ">=", value: 4, negate: false },
      { kind: "mood", op: "=", value: 2, negate: true },
      { kind: "before", value: "2026-12-01", negate: false },
      { kind: "after", value: "2025-01-01", negate: false },
    ]);
  });
  it("treats unknown operators and bad values as words, and copes with an open quote", () => {
    expect(parseQuery('foo:bar mood:9 before:soon # "open')).toEqual([
      { kind: "word", value: "foo:bar", negate: false },
      { kind: "word", value: "mood:9", negate: false },
      { kind: "word", value: "before:soon", negate: false },
      { kind: "word", value: "#", negate: false },
      { kind: "phrase", value: "open", negate: false },
    ]);
    expect(parseQuery('  "" ')).toEqual([]);
  });
});

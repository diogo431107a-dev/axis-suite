import { describe, expect, it } from "vitest";
import { displayName, initialOf, initials, internationalDigits, listName, whatsappLink } from "./contact.ts";
import { ageOn, inYear, isPartialDate, nextOccurrence, partialDate } from "./dates.ts";
import { parseQuery } from "./query.ts";

const person = (firstName: string, lastName = "", nickname = "", company = "") => ({
  firstName,
  lastName,
  nickname,
  company,
});

describe("dates to remember", () => {
  it("are full days or --MM-DD", () => {
    expect(isPartialDate("1986-10-13")).toBe(true);
    expect(isPartialDate("--10-13")).toBe(true);
    expect(isPartialDate("--02-29")).toBe(true);
    expect(isPartialDate("1985-02-29")).toBe(false);
    expect(isPartialDate("--02-30")).toBe(false);
    expect(isPartialDate("--13-01")).toBe(false);
    expect(isPartialDate("10-13")).toBe(false);
    expect(partialDate(null, 2, 9)).toBe("--02-09");
    expect(partialDate(1986, 10, 13)).toBe("1986-10-13");
  });

  it("come round on the same day, 29 February on the 28th in other years", () => {
    expect(inYear("2000-02-29", 2027)).toBe("2027-02-28");
    expect(inYear("--02-29", 2028)).toBe("2028-02-29");
    expect(nextOccurrence("1986-10-13", "2026-10-12")).toBe("2026-10-13");
    expect(nextOccurrence("1986-10-12", "2026-10-12")).toBe("2026-10-12");
    expect(nextOccurrence("--01-05", "2026-12-30")).toBe("2027-01-05");
    expect(nextOccurrence("--02-29", "2027-01-01")).toBe("2027-02-28");
  });

  it("give an age when the year is known", () => {
    expect(ageOn("1986-10-13", "2026-10-12")).toBe(39);
    expect(ageOn("1986-10-13", "2026-10-13")).toBe(40);
    expect(ageOn("--10-13", "2026-10-13")).toBeNull();
    expect(ageOn("2000-02-29", "2027-02-28")).toBe(27);
    expect(ageOn("2030-01-01", "2026-10-12")).toBeNull();
  });
});

describe("names", () => {
  it("fall back to the nickname, then the company", () => {
    expect(displayName(person("Maria", "Souza"))).toBe("Maria Souza");
    expect(displayName(person("", "Souza"))).toBe("Souza");
    expect(displayName(person("", "", "Zé", "Acme"))).toBe("Zé");
    expect(displayName(person("", "", "", "Acme"))).toBe("Acme");
  });

  it("list by last name when asked", () => {
    expect(listName(person("Maria", "Souza"), "last")).toBe("Souza, Maria");
    expect(listName(person("Maria"), "last")).toBe("Maria");
    expect(initialOf(person("Élida", "Souza"), "first")).toBe("E");
    expect(initialOf(person("Élida", "Souza"), "last")).toBe("S");
    expect(initialOf(person("", "", "", "3M"), "first")).toBe("#");
  });

  it("make initials", () => {
    expect(initials(person("Maria", "da Silva Souza"))).toBe("MS");
    expect(initials(person("Ana"))).toBe("A");
    expect(initials(person("", "", "", "(Acme)"))).toBe("(");
  });
});

describe("phones", () => {
  it("get the country code for WhatsApp unless they have one", () => {
    expect(internationalDigits("(11) 98765-4321", "55")).toBe("5511987654321");
    expect(internationalDigits("011 98765-4321", "55")).toBe("5511987654321");
    expect(internationalDigits("+351 912 345 678", "55")).toBe("351912345678");
    expect(internationalDigits("00351 912 345 678", "55")).toBe("351912345678");
    expect(internationalDigits("123", "55")).toBeNull();
    expect(whatsappLink("(11) 98765-4321", "55")).toBe("https://wa.me/5511987654321");
  });
});

describe("search queries", () => {
  it("split into words and phrases, without case or accents", () => {
    expect(parseQuery('João "são paulo"  ')).toEqual([
      { value: "joao", digits: null },
      { value: "sao paulo", digits: null },
    ]);
  });

  it("also match phone-like words by their digits", () => {
    expect(parseQuery("(11) 98765-4321 2024")).toEqual([
      { value: "(11)", digits: "11" },
      { value: "98765-4321", digits: "987654321" },
      { value: "2024", digits: null },
    ]);
  });
});

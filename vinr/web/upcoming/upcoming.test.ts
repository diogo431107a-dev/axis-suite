import { describe, expect, it } from "vitest";
import type { ContactSummary } from "../../shared/protocol.ts";
import { upcoming } from "./upcoming.ts";

const contact = (id: string, birthday: string | null, dates: ContactSummary["dates"] = []): ContactSummary => ({
  id,
  firstName: id,
  lastName: "",
  nickname: "",
  company: "",
  title: "",
  favorite: false,
  groupIds: [],
  phone: "",
  email: "",
  birthday,
  dates,
  rev: 1,
  deletedAt: null,
});

const brief = (today: string, days: number, contacts: ContactSummary[]) =>
  upcoming(contacts, today, days).map((o) => `${o.contact.id} ${o.label} ${o.on} ${o.inDays} ${o.years}`);

describe("upcoming dates", () => {
  it("are soonest first, birthdays before other dates on the same day, with the age reached", () => {
    const people = [
      contact("ana", "1986-10-13"),
      contact("bia", "--10-12", [{ label: "Anniversary", date: "2010-10-12" }]),
      contact("caio", "1990-09-01"),
    ];
    expect(brief("2026-10-12", 30, people)).toEqual([
      "bia Birthday 2026-10-12 0 null",
      "bia Anniversary 2026-10-12 0 16",
      "ana Birthday 2026-10-13 1 40",
    ]);
  });

  it("cross the new year", () => {
    expect(brief("2026-12-30", 7, [contact("ana", "2000-01-02"), contact("bia", "--12-29")])).toEqual([
      "ana Birthday 2027-01-02 3 27",
    ]);
  });

  it("keep 29 February on the 28th outside leap years", () => {
    expect(brief("2027-02-01", 30, [contact("ana", "2000-02-29")])).toEqual(["ana Birthday 2027-02-28 27 27"]);
    expect(brief("2028-02-01", 30, [contact("ana", "2000-02-29")])).toEqual(["ana Birthday 2028-02-29 28 28"]);
  });

  it("name dates without a label", () => {
    expect(brief("2026-10-12", 7, [contact("ana", null, [{ label: "", date: "--10-14" }])])).toEqual([
      "ana Date 2026-10-14 2 null",
    ]);
  });
});

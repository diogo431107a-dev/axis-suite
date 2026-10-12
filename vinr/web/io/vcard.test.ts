import { describe, expect, it } from "vitest";
import type { ExportContact } from "../../shared/protocol.ts";
import { fold, parseVcards, splitStreet, vcardDate, writeVcard, writeVcards } from "./vcard.ts";

const crlf = (lines: string[]) => lines.join("\r\n") + "\r\n";

// As Google Contacts exports them (vCard 3.0).
const GOOGLE = crlf([
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Maria Souza",
  "N:Souza;Maria;;;",
  "NICKNAME:Mari",
  "EMAIL;TYPE=INTERNET;TYPE=WORK:maria@acme.com.br",
  "EMAIL;TYPE=INTERNET;TYPE=HOME:mari@gmail.com",
  "TEL;TYPE=CELL:+55 11 98765-4321",
  "TEL;TYPE=WORK:(11) 3333-4444",
  "ADR;TYPE=HOME:;apto 42;Avenida Paulista\\, 1000 - Bela Vista;São Paulo;SP;01310-100;Brasil",
  "ORG:Acme Ltda;Engenharia",
  "TITLE:Engenheira",
  "BDAY:1986-10-13",
  "URL:https://linkedin.com/in/maria",
  "NOTE:Met at the conference.\\nLikes café\\, strong.",
  "CATEGORIES:myContacts,Family,starred",
  "PHOTO:https://lh3.googleusercontent.com/x",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:",
  "N:;;;;",
  "TEL;TYPE=CELL:+55 21 99999-0000",
  "END:VCARD",
]);

// As an iPhone exports them: labels tied to properties by item groups, no-year birthdays in 1604.
const IPHONE = crlf([
  "BEGIN:VCARD",
  "VERSION:3.0",
  "PRODID:-//Apple Inc.//iPhone OS 17.0//EN",
  "N:Silva;João;;;",
  "FN:João Silva",
  "item1.TEL;type=pref:+55 21 3333-4444",
  "item1.X-ABLabel:_$!<Mobile>!$_",
  "BDAY;X-APPLE-OMIT-YEAR=1604:1604-02-29",
  "item2.X-ABDATE;type=pref:2010-05-20",
  "item2.X-ABLabel:_$!<Anniversary>!$_",
  "item3.URL:www.joao.dev",
  "item3.X-ABLabel:Blog",
  "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx",
  " NDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy",
  "END:VCARD",
]);

// As older Android phones export them: vCard 2.1, accents in quoted-printable UTF-8.
const ANDROID = crlf([
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Concei=C3=A7=C3=A3o;Jos=C3=A9;;;",
  "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Concei=C3=A7=C3=A3o",
  "TEL;CELL;PREF:011987654321",
  "TEL;HOME:1133334444",
  "EMAIL;HOME:jose@example.com",
  "NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Primeira linha=0D=0ASegunda li=",
  "nha com acentua=C3=A7=C3=A3o",
  "END:VCARD",
]);

// vCard 4.0, as Outlook and others write it.
const V4 = crlf([
  "BEGIN:VCARD",
  "VERSION:4.0",
  "KIND:individual",
  "FN:Ana Lima",
  "N:Lima;Ana;;;",
  'TEL;VALUE=uri;TYPE="voice,work":tel:+55-11-5555-6666',
  "EMAIL;TYPE=work:mailto:ana@empresa.com",
  "BDAY:--0704",
  "ANNIVERSARY:20150912",
  "ORG:Empresa SA",
  "END:VCARD",
]);

describe("reading vCards", () => {
  it("reads Google's export: names, labels, addresses, groups and the star", () => {
    const { contacts, skipped, ignored } = parseVcards(GOOGLE);
    expect(skipped).toBe(0);
    expect(contacts[0]).toEqual({
      firstName: "Maria",
      lastName: "Souza",
      nickname: "Mari",
      company: "Acme Ltda",
      title: "Engenheira",
      birthday: "1986-10-13",
      phones: [
        { label: "mobile", number: "+55 11 98765-4321", whatsapp: false },
        { label: "work", number: "(11) 3333-4444", whatsapp: false },
      ],
      emails: [
        { label: "work", address: "maria@acme.com.br" },
        { label: "home", address: "mari@gmail.com" },
      ],
      addresses: [
        {
          label: "home",
          street: "Avenida Paulista",
          number: "1000",
          complement: "apto 42",
          district: "Bela Vista",
          city: "São Paulo",
          state: "SP",
          postalCode: "01310-100",
          country: "Brasil",
        },
      ],
      websites: [{ label: "", url: "https://linkedin.com/in/maria" }],
      dates: [],
      memo: "Met at the conference.\nLikes café, strong.",
      favorite: true,
      groups: ["Family"],
    } satisfies ExportContact);
    expect(ignored).toEqual(new Map([["PHOTO", 1]]));
  });

  it("names a card without a name by its number", () => {
    const { contacts } = parseVcards(GOOGLE);
    expect(contacts[1]).toMatchObject({ firstName: "", nickname: "+55 21 99999-0000" });
  });

  it("reads an iPhone's labels, its no-year birthdays and folded photos", () => {
    const { contacts, ignored } = parseVcards(IPHONE);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      firstName: "João",
      lastName: "Silva",
      birthday: "--02-29",
      phones: [{ label: "mobile", number: "+55 21 3333-4444", whatsapp: false }],
      dates: [{ label: "Anniversary", date: "2010-05-20" }],
      websites: [{ label: "Blog", url: "https://www.joao.dev" }],
    });
    expect(ignored.get("PHOTO")).toBe(1);
  });

  it("reads Android's quoted-printable 2.1", () => {
    const { contacts } = parseVcards(ANDROID);
    expect(contacts[0]).toMatchObject({
      firstName: "José",
      lastName: "Conceição",
      phones: [
        { label: "mobile", number: "011987654321" },
        { label: "home", number: "1133334444" },
      ],
      emails: [{ label: "home", address: "jose@example.com" }],
      memo: "Primeira linha\nSegunda linha com acentuação",
    });
  });

  it("reads vCard 4.0's tel: and mailto: values and compact dates", () => {
    const { contacts } = parseVcards(V4);
    expect(contacts[0]).toMatchObject({
      firstName: "Ana",
      company: "Empresa SA",
      birthday: "--07-04",
      phones: [{ label: "work", number: "+55-11-5555-6666" }],
      emails: [{ label: "work", address: "ana@empresa.com" }],
      dates: [{ label: "Anniversary", date: "2015-09-12" }],
    });
  });

  it("keeps the first phones when a card has more than Vinr keeps", () => {
    const tels = Array.from({ length: 7 }, (_, i) => `TEL:9999-000${i}`);
    const { contacts, trimmed } = parseVcards(crlf(["BEGIN:VCARD", "VERSION:3.0", "FN:Many", ...tels, "END:VCARD"]));
    expect(contacts[0]!.phones.map((p) => p.number)).toEqual(tels.slice(0, 5).map((t) => t.slice(4)));
    expect(trimmed).toBe(1);
  });

  it("skips cards with nothing to keep, and a BOM and bare LF line ends", () => {
    const r = parseVcards("﻿BEGIN:VCARD\nVERSION:3.0\nFN:\nNOTE:nobody\nEND:VCARD\n");
    expect([r.contacts.length, r.skipped]).toEqual([0, 1]);
  });

  it("understands dates in every form", () => {
    expect(vcardDate("19861013")).toBe("1986-10-13");
    expect(vcardDate("1986-10-13T00:00:00Z")).toBe("1986-10-13");
    expect(vcardDate("--1013")).toBe("--10-13");
    expect(vcardDate("1986-02-30")).toBeNull();
    expect(vcardDate("circa 1990")).toBeNull();
  });

  it("splits Brazilian street lines", () => {
    expect(splitStreet("Rua das Flores, 25A - Centro")).toEqual({
      street: "Rua das Flores",
      number: "25A",
      district: "Centro",
    });
    expect(splitStreet("Estrada Velha, s/n")).toEqual({ street: "Estrada Velha", number: "s/n", district: "" });
    expect(splitStreet("221B Baker Street")).toEqual({ street: "221B Baker Street", number: "", district: "" });
  });
});

describe("writing vCards", () => {
  it("round-trips what it writes", () => {
    const { contacts } = parseVcards(GOOGLE + IPHONE + ANDROID + V4);
    const again = parseVcards(writeVcards(contacts));
    // Written cards carry the labels and dates, but not the star (other apps would make a group of it).
    expect(again.contacts).toEqual(contacts.map((c) => ({ ...c, favorite: false })));
  });

  it("escapes and folds lines at 75 bytes without breaking characters", () => {
    const memo = `${"ç".repeat(60)}; a, b\\ c\nnext`;
    const card = writeVcard({ ...parseVcards(V4).contacts[0]!, memo });
    for (const line of card.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(card).toContain("\r\n ");
    expect(parseVcards(card).contacts[0]!.memo).toBe(memo);
    expect(fold("short")).toBe("short");
  });

  it("writes no-year dates as --MM-DD", () => {
    const card = writeVcard({ ...parseVcards(IPHONE).contacts[0]! });
    expect(card).toContain("BDAY:--02-29");
    expect(card).toMatch(/item\d\.X-ABDATE:2010-05-20/);
  });
});

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContactCreate, ExportFile } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { StoreError, createStore, type Store } from "./store.ts";

/** The StoreError a call throws (fails the test if it doesn't throw one). */
function refusal(fn: () => unknown): StoreError {
  try {
    fn();
  } catch (err) {
    if (err instanceof StoreError) return err;
    throw err;
  }
  throw new Error("expected a StoreError");
}

let db: DatabaseSync;
let store: Store;

beforeEach(() => {
  db = openDatabase(":memory:");
  store = createStore(db);
});

const maria: ContactCreate = {
  firstName: "Maria",
  lastName: "Souza",
  nickname: "",
  company: "Acme Ltda",
  title: "Engenheira",
  birthday: "1986-10-13",
  phones: [{ label: "mobile", number: "+55 (11) 98765-4321", whatsapp: true }],
  emails: [{ label: "work", address: "maria@acme.com.br" }],
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
  websites: [{ label: "LinkedIn", url: "https://linkedin.com/in/maria" }],
  dates: [{ label: "Anniversary", date: "--05-20" }],
  memo: "Met at the conference.\nLikes café.",
  groupIds: [],
};

/** A contact with only these fields. */
const only = (fields: Partial<ContactCreate>): ContactCreate => ({
  firstName: "",
  lastName: "",
  nickname: "",
  company: "",
  title: "",
  birthday: null,
  phones: [],
  emails: [],
  addresses: [],
  websites: [],
  dates: [],
  memo: "",
  groupIds: [],
  ...fields,
});

const names = (owner: string, query: Record<string, string> = {}) =>
  store
    .list(owner, query)
    .map((c) => `${c.firstName} ${c.lastName}`.trim())
    .sort();

describe("contacts", () => {
  it("stores every field and gives it back", () => {
    const { id, rev } = store.create("alice", maria);
    const c = store.get("alice", id);
    expect(c).toMatchObject({ ...maria, id, rev, favorite: false, deletedAt: null });
    expect(store.list("alice", {})).toEqual([
      expect.objectContaining({
        id,
        firstName: "Maria",
        phone: "+55 (11) 98765-4321",
        email: "maria@acme.com.br",
        birthday: "1986-10-13",
        dates: maria.dates,
      }),
    ]);
  });

  it("keeps each user's contacts apart", () => {
    const { id } = store.create("bob", maria);
    expect(store.list("alice", {})).toEqual([]);
    expect(refusal(() => store.get("alice", id)).status).toBe(404);
    expect(refusal(() => store.put("alice", id, { ...maria, rev: 1 })).status).toBe(404);
    expect(refusal(() => store.patch("alice", id, { favorite: true })).status).toBe(404);
    expect(refusal(() => store.bin("alice", id)).status).toBe(404);
    expect(store.get("bob", id).firstName).toBe("Maria");
  });

  it("needs a name or a company, and tidies what it is given", () => {
    expect(refusal(() => store.create("alice", only({ memo: "who?" }))).message).toMatch(/name or a company/);
    const { id } = store.create("alice", {
      ...only({ firstName: "  Ana ", company: "" }),
      phones: [
        { label: "mobile", number: "  ", whatsapp: false },
        { label: "work", number: " 3333-4444 ", whatsapp: false },
      ],
      emails: [{ label: "home", address: "" }],
      websites: [{ label: "", url: "example.com/ana" }],
      memo: "line\n\n  ",
    });
    expect(store.get("alice", id)).toMatchObject({
      firstName: "Ana",
      phones: [{ label: "work", number: "3333-4444", whatsapp: false }],
      emails: [],
      websites: [{ label: "", url: "https://example.com/ana" }],
      memo: "line",
    });
    expect(store.create("alice", only({ company: "Acme" })).id).toBeTruthy();
    expect(store.create("alice", only({ nickname: "Zé" })).id).toBeTruthy();
  });

  it("refuses what isn't valid", () => {
    const bad = (fields: Partial<ContactCreate>) => refusal(() => store.create("alice", { ...maria, ...fields })).code;
    expect(bad({ birthday: "1986-02-30" })).toBe("invalid");
    expect(bad({ birthday: "13/10/1986" })).toBe("invalid");
    expect(bad({ emails: [{ label: "home", address: "not an email" }] })).toBe("invalid");
    expect(bad({ phones: [{ label: "mobile", number: "call me", whatsapp: false }] })).toBe("invalid");
    expect(bad({ phones: [{ label: "fax" as "other", number: "123", whatsapp: false }] })).toBe("invalid");
    expect(bad({ websites: [{ label: "", url: "javascript:alert(1)" }] })).toBe("invalid");
    expect(bad({ websites: [{ label: "", url: "ftp://example.com" }] })).toBe("invalid");
    expect(bad({ dates: [{ label: "Anniversary", date: "" }] })).toBe("invalid");
    expect(bad({ firstName: "x".repeat(101) })).toBe("invalid");
    expect(bad({ groupIds: ["no-such-group"] })).toBe("invalid");
  });

  it("allows birthdays without a year, 29 February included", () => {
    const { id } = store.create("alice", { ...maria, birthday: "--02-29" });
    expect(store.get("alice", id).birthday).toBe("--02-29");
    expect(refusal(() => store.create("alice", { ...maria, birthday: "--02-30" })).code).toBe("invalid");
  });

  it("keeps to the limits on phones, emails and the rest", () => {
    const phones = Array.from({ length: 6 }, (_, i) => ({
      label: "mobile" as const,
      number: `9999-000${i}`,
      whatsapp: false,
    }));
    expect(refusal(() => store.create("alice", { ...maria, phones })).message).toMatch(/At most 5 phones/);
    expect(store.create("alice", { ...maria, phones: phones.slice(0, 5) }).id).toBeTruthy();
    const addresses = Array.from({ length: 4 }, () => maria.addresses[0]!);
    expect(refusal(() => store.create("alice", { ...maria, addresses })).message).toMatch(/At most 3 addresses/);
  });

  it("saves over the version it was opened on, and answers a conflict otherwise", () => {
    const { id, rev } = store.create("alice", maria);
    const saved = store.put("alice", id, { ...maria, title: "Diretora", rev });
    expect(saved.rev).toBeGreaterThan(rev);
    const err = refusal(() => store.put("alice", id, { ...maria, title: "Gerente", rev }));
    expect([err.status, err.code, err.contact?.title]).toEqual([409, "conflict", "Diretora"]);
    // Sending what is already there succeeds, whatever the rev.
    expect(store.put("alice", id, { ...maria, title: "Diretora", rev })).toEqual(saved);
  });

  it("stars a contact without changing its rev", () => {
    const { id, rev } = store.create("alice", maria);
    expect(store.patch("alice", id, { favorite: true })).toMatchObject({ favorite: true, rev });
    store.create("alice", only({ firstName: "Ana" }));
    expect(names("alice", { favorites: "1" })).toEqual(["Maria Souza"]);
    expect(refusal(() => store.patch("alice", id, { favorite: "yes" })).code).toBe("invalid");
  });

  it("moves contacts to the recycle bin, restores them and purges them after 30 days", () => {
    const { id } = store.create("alice", maria);
    expect(refusal(() => store.purgeContact("alice", id)).code).toBe("not-in-bin");
    store.bin("alice", id);
    expect(names("alice")).toEqual([]);
    expect(names("alice", { bin: "1" })).toEqual(["Maria Souza"]);
    expect(refusal(() => store.get("alice", id)).status).toBe(404);
    expect(store.restore("alice", id).deletedAt).toBeNull();
    store.bin("alice", id);
    expect(store.purge(Date.now() + 29 * 86_400_000)).toBe(0);
    expect(store.purge(Date.now() + 31 * 86_400_000)).toBe(1);
    expect(refusal(() => store.restore("alice", id)).status).toBe(404);

    const other = store.create("alice", maria);
    store.bin("alice", other.id);
    store.purgeContact("alice", other.id);
    expect(names("alice", { bin: "1" })).toEqual([]);
  });
});

describe("search", () => {
  beforeEach(() => {
    store.create("alice", maria);
    store.create(
      "alice",
      only({
        firstName: "João",
        lastName: "Silva",
        phones: [{ label: "home", number: "(21) 3333-4444", whatsapp: false }],
      }),
    );
    store.create("alice", only({ firstName: "Ana", company: "Café Brasil" }));
  });

  const find = (q: string) => names("alice", { q });

  it("ignores case and accents, both ways", () => {
    expect(find("joao")).toEqual(["João Silva"]);
    expect(find("CAFE")).toEqual(["Ana", "Maria Souza"]);
    expect(find("são paulo")).toEqual(["Maria Souza"]);
  });

  it("needs every word, and phrases together", () => {
    expect(find("ana brasil")).toEqual(["Ana"]);
    expect(find("ana silva")).toEqual([]);
    expect(find('"the conference"')).toEqual(["Maria Souza"]);
    expect(find('"conference the"')).toEqual([]);
  });

  it("finds phone numbers however they are typed", () => {
    expect(find("987654321")).toEqual(["Maria Souza"]);
    expect(find("98765-4321")).toEqual(["Maria Souza"]);
    expect(find("(21) 33334444")).toEqual(["João Silva"]);
    expect(find("2133334444")).toEqual(["João Silva"]);
  });

  it("looks in emails, addresses, websites, dates and the memo", () => {
    expect(find("acme.com")).toEqual(["Maria Souza"]);
    expect(find("01310100")).toEqual(["Maria Souza"]);
    expect(find("bela vista")).toEqual(["Maria Souza"]);
    expect(find("linkedin")).toEqual(["Maria Souza"]);
    expect(find("anniversary")).toEqual(["Maria Souza"]);
    expect(find("conference")).toEqual(["Maria Souza"]);
  });

  it("refuses an overlong search", () => {
    expect(refusal(() => store.list("alice", { q: "x".repeat(201) })).code).toBe("invalid");
  });
});

describe("groups", () => {
  it("are unique by name, ignoring case, and get a free colour", () => {
    const family = store.createGroup("alice", { name: "Family" });
    expect(family).toMatchObject({ name: "Family", color: "teal", members: 0 });
    expect(store.createGroup("alice", { name: "Work" }).color).toBe("sky");
    expect(refusal(() => store.createGroup("alice", { name: " family " })).code).toBe("exists");
    expect(store.createGroup("bob", { name: "Family" }).id).not.toBe(family.id);
    expect(refusal(() => store.updateGroup("alice", family.id, { name: "WORK" })).code).toBe("exists");
    expect(store.updateGroup("alice", family.id, { name: "family", color: "rose" })).toMatchObject({
      name: "family",
      color: "rose",
    });
  });

  it("count members outside the bin, filter the list, and leave contacts when deleted", () => {
    const family = store.createGroup("alice", { name: "Family" });
    const a = store.create("alice", { ...maria, groupIds: [family.id, family.id] });
    store.create("alice", only({ firstName: "Ana", groupIds: [family.id] }));
    store.create("alice", only({ firstName: "Zé" }));
    expect(store.get("alice", a.id).groupIds).toEqual([family.id]);
    expect(names("alice", { group: family.id })).toEqual(["Ana", "Maria Souza"]);
    store.bin("alice", a.id);
    expect(store.groups("alice")[0]!.members).toBe(1);
    store.deleteGroup("alice", family.id);
    expect(store.restore("alice", a.id).groupIds).toEqual([]);
    expect(names("alice")).toEqual(["Ana", "Maria Souza", "Zé"]);
  });

  it("can't be used across users", () => {
    const bobs = store.createGroup("bob", { name: "Family" });
    expect(refusal(() => store.create("alice", { ...maria, groupIds: [bobs.id] })).code).toBe("invalid");
    expect(refusal(() => store.deleteGroup("alice", bobs.id)).status).toBe(404);
  });
});

describe("settings", () => {
  it("default to first names and Brazil, and are checked", () => {
    expect(store.settings("alice")).toEqual({ sortBy: "first", countryCode: "55" });
    expect(store.putSettings("alice", { sortBy: "last", countryCode: "+351" })).toEqual({
      sortBy: "last",
      countryCode: "351",
    });
    expect(store.settings("alice").sortBy).toBe("last");
    expect(refusal(() => store.putSettings("alice", { sortBy: "age" })).code).toBe("invalid");
    expect(refusal(() => store.putSettings("alice", { countryCode: "12345" })).code).toBe("invalid");
  });
});

describe("export and import", () => {
  const file = (
    contacts: Partial<ExportFile["contacts"][number]>[],
    groups: ExportFile["groups"] = [],
  ): ExportFile => ({
    format: "vinr",
    version: 1,
    exportedAt: new Date().toISOString(),
    groups,
    contacts: contacts.map((c) => {
      const { groupIds: _, ...fields } = only({});
      return { ...fields, favorite: false, groups: [], ...c };
    }),
  });

  it("round-trips everything to another user, and a second import changes nothing", () => {
    const family = store.createGroup("alice", { name: "Family", color: "rose" });
    const { id } = store.create("alice", { ...maria, groupIds: [family.id] });
    store.patch("alice", id, { favorite: true });
    store.create("alice", only({ company: "Padaria" }));
    store.putSettings("alice", { sortBy: "last", countryCode: "55" });
    const exported = store.exportAll("alice");

    expect(store.importAll("bob", exported)).toEqual({ added: 2, merged: 0, unchanged: 0, groups: 1 });
    const again = store.exportAll("bob");
    // Both were made in the same millisecond, so their order is the ids'.
    const strip = (f: ExportFile) => ({
      ...f,
      exportedAt: "",
      contacts: f.contacts.toSorted((a, b) => a.company.localeCompare(b.company)),
    });
    expect(strip(again)).toEqual(strip(exported));
    expect(store.importAll("bob", exported)).toEqual({ added: 0, merged: 0, unchanged: 2, groups: 0 });
    expect(store.groups("bob")).toEqual([expect.objectContaining({ name: "Family", color: "rose", members: 1 })]);
  });

  it("fills a matching contact with what it lacks", () => {
    const { id } = store.create("alice", {
      ...only({ firstName: "Maria", lastName: "Souza", birthday: "--10-13", memo: "Old note" }),
      phones: [{ label: "mobile", number: "(11) 98765-4321", whatsapp: false }],
    });
    const r = store.importAll(
      "alice",
      file([
        {
          firstName: "maria",
          lastName: "SOUZA",
          title: "Engenheira",
          birthday: "1986-10-13",
          phones: [
            { label: "mobile", number: "+55 11 98765-4321", whatsapp: true },
            { label: "work", number: "3333-4444", whatsapp: false },
          ],
          emails: [{ label: "work", address: "maria@acme.com.br" }],
          memo: "New note",
          groups: ["Work"],
        },
      ]),
    );
    expect(r).toEqual({ added: 0, merged: 1, unchanged: 0, groups: 1 });
    const c = store.get("alice", id);
    expect(c).toMatchObject({
      firstName: "Maria",
      title: "Engenheira",
      birthday: "1986-10-13",
      memo: "Old note\n\nNew note",
    });
    expect(c.phones.map((p) => p.number)).toEqual(["(11) 98765-4321", "3333-4444"]);
    expect(c.emails).toHaveLength(1);
    expect(c.groupIds).toHaveLength(1);
  });

  it("adds a namesake who shares no phone or email as someone else", () => {
    store.create("alice", { ...only({ firstName: "Ana" }), emails: [{ label: "home", address: "ana@a.com" }] });
    store.create("alice", only({ firstName: "Bia" }));
    const r = store.importAll(
      "alice",
      file([
        { firstName: "Ana", emails: [{ label: "home", address: "other@b.com" }] },
        { firstName: "Ana" },
        { firstName: "Bia" },
        { firstName: "Bia", phones: [{ label: "mobile", number: "9999-8888", whatsapp: false }] },
      ]),
    );
    expect(r).toEqual({ added: 3, merged: 0, unchanged: 1, groups: 0 });
  });

  it("merges the same person twice in one file", () => {
    const r = store.importAll(
      "alice",
      file([
        { firstName: "Ana", emails: [{ label: "home", address: "ana@a.com" }] },
        {
          firstName: "Ana",
          emails: [{ label: "home", address: "ANA@a.com" }],
          phones: [{ label: "mobile", number: "9999-8888", whatsapp: false }],
        },
      ]),
    );
    expect(r).toEqual({ added: 1, merged: 1, unchanged: 0, groups: 0 });
    expect(store.list("alice", {})[0]!.phone).toBe("9999-8888");
  });

  it("keeps to the limits when merging", () => {
    const phones = (from: number) =>
      Array.from({ length: 3 }, (_, i) => ({
        label: "mobile" as const,
        number: `9999-00${from + i}0`,
        whatsapp: false,
      }));
    const { id } = store.create("alice", { ...only({ firstName: "Ana" }), phones: phones(0) });
    store.importAll("alice", file([{ firstName: "Ana", phones: [...phones(0).slice(0, 1), ...phones(3)] }]));
    expect(store.get("alice", id).phones).toHaveLength(5);
  });

  it("writes nothing from a bad file", () => {
    const err = refusal(() =>
      store.importAll(
        "alice",
        file([{ firstName: "Ana" }, { firstName: "Bad", birthday: "yesterday" }], [{ name: "G", color: "teal" }]),
      ),
    );
    expect(err.message).toMatch(/^Contact 2: /);
    expect(store.list("alice", {})).toEqual([]);
    expect(store.groups("alice")).toEqual([]);
    expect(refusal(() => store.importAll("alice", { format: "papyrus", version: 1 })).code).toBe("invalid");
  });

  it("keeps the user's own settings", () => {
    store.putSettings("alice", { sortBy: "first", countryCode: "351" });
    store.importAll("alice", { ...file([]), settings: { sortBy: "last", countryCode: "55" } });
    expect(store.settings("alice")).toEqual({ sortBy: "first", countryCode: "351" });
    store.importAll("bob", { ...file([]), settings: { sortBy: "last", countryCode: "55" } });
    expect(store.settings("bob")).toEqual({ sortBy: "last", countryCode: "55" });
  });
});

describe("removed users", () => {
  it("lose everything; the others keep theirs", () => {
    const g = store.createGroup("carol", { name: "Family" });
    const { id } = store.create("carol", { ...maria, groupIds: [g.id] });
    store.create("carol", maria);
    store.bin("carol", id);
    store.putSettings("carol", { sortBy: "last" });
    store.create("alice", maria);
    expect(store.removeUnknownOwners(new Set(["alice"]))).toEqual([{ owner: "carol", contacts: 2 }]);
    expect(store.list("carol", {})).toEqual([]);
    expect(store.list("carol", { bin: "1" })).toEqual([]);
    expect(store.groups("carol")).toEqual([]);
    expect(store.settings("carol").sortBy).toBe("first");
    expect(names("alice")).toEqual(["Maria Souza"]);
    expect(db.prepare("SELECT count(*) AS n FROM contact_groups").get()).toEqual({ n: 0 });
  });
});

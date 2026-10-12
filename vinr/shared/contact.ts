// What the server and the page both work out from a contact: its name as shown and sorted, the
// digits of a phone, WhatsApp links and the text search runs on.
import type { ContactFields, Settings } from "./protocol.ts";
import { normalize } from "./words.ts";

type Named = Pick<ContactFields, "firstName" | "lastName" | "nickname" | "company">;

/** "Maria Souza"; without a name, the nickname, then the company. */
export function displayName(c: Named): string {
  const full = [c.firstName, c.lastName].map((s) => s.trim()).filter(Boolean);
  return full.length > 0 ? full.join(" ") : c.nickname.trim() || c.company.trim() || "No name";
}

/**
 * As the list shows it, and sorts it (with Intl.Collator): "Souza, Maria" when sorting by last
 * name, else as displayName.
 */
export function listName(c: Named, sortBy: Settings["sortBy"]): string {
  const first = c.firstName.trim();
  const last = c.lastName.trim();
  if (sortBy === "last" && first && last) return `${last}, ${first}`;
  return displayName(c);
}

/** The letter the list files a contact under: A–Z (accents dropped), else "#". */
export function initialOf(c: Named, sortBy: Settings["sortBy"]): string {
  const first = normalize(listName(c, sortBy)).charAt(0).toUpperCase();
  return /\p{L}/u.test(first) ? first : "#";
}

/** Up to two letters for the round avatar: "MS" for Maria Souza. */
export function initials(c: Named): string {
  const words = displayName(c)
    .split(/\s+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w));
  const letters = (words.length > 1 ? [words[0]!, words.at(-1)!] : words.slice(0, 1)).map((w) =>
    String.fromCodePoint(w.codePointAt(0)!),
  );
  return letters.join("").toUpperCase() || "?";
}

/** A phone number's digits only: "+55 (11) 98765-4321" → "5511987654321". */
export const phoneDigits = (number: string) => number.replace(/\D/g, "");

/**
 * The international number for WhatsApp, digits only, or null if there are too few digits. A
 * number written with "+" (or "00") already has its country code; any other gets `countryCode`,
 * after dropping leading zeros (a trunk prefix such as Brazil's 0).
 */
export function internationalDigits(number: string, countryCode: string): string | null {
  const trimmed = number.trim();
  let digits = phoneDigits(trimmed);
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    digits = phoneDigits(countryCode) + digits.replace(/^0+/, "");
  }
  return digits.length >= 8 ? digits : null;
}

/** https://wa.me/… for a phone number, or null if it has too few digits. */
export function whatsappLink(number: string, countryCode: string): string | null {
  const digits = internationalDigits(number, countryCode);
  return digits ? `https://wa.me/${digits}` : null;
}

/** Whether a website address may be stored and shown as a link: http or https only. */
export function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Everything search looks in, lower case and without accents, one field per line: the names,
 * company, title, phones (as typed and as digits), emails, addresses, websites, date labels and
 * the memo.
 */
export function searchText(c: Omit<ContactFields, "favorite" | "groupIds">): string {
  const parts = [
    c.firstName,
    c.lastName,
    c.nickname,
    c.company,
    c.title,
    ...c.phones.flatMap((p) => [p.number, phoneDigits(p.number)]),
    ...c.emails.map((e) => e.address),
    ...c.addresses.flatMap((a) => [
      a.street,
      a.number,
      a.complement,
      a.district,
      a.city,
      a.state,
      a.postalCode,
      phoneDigits(a.postalCode),
      a.country,
    ]),
    ...c.websites.flatMap((w) => [w.label, w.url]),
    ...c.dates.map((d) => d.label),
    c.memo,
  ];
  return normalize(parts.filter((s) => s.trim()).join("\n"));
}

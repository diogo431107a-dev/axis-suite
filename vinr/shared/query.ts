// The search box's language: words and "exact phrases", separated by spaces, which must all be
// somewhere in the contact, ignoring case and accents. A word that looks like part of a phone
// number ("(11)", "98765-4321") also matches the number's digits, however the number was typed.
import { normalize } from "./words.ts";

export interface Term {
  /** lower case, without accents */
  value: string;
  /** for a word made of digits and phone punctuation: the digits alone */
  digits: string | null;
}

const PHONE_LIKE = /^[\d()+\-./]+$/;

export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  // "a phrase" or word
  for (const m of query.matchAll(/"([^"]*)"?|(\S+)/g)) {
    const raw = m[1] ?? m[2]!;
    const value = normalize(raw.trim());
    if (!value) continue;
    const digits = m[2] !== undefined && PHONE_LIKE.test(raw) ? raw.replace(/\D/g, "") : "";
    terms.push({ value, digits: digits && digits !== value ? digits : null });
  }
  return terms;
}

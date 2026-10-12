// vCard (.vcf) files: read the 2.1, 3.0 and 4.0 files that Google Contacts, iPhones, Android
// phones and Outlook export, and write 3.0, which all of them read. Contacts come out in the
// shape of an export file, so an import goes through the server's one import path.
//
// Vinr's postal addresses are Brazilian style (street, number, complement, district); vCard has
// one street line. Vinr writes "Avenida Paulista, 1000 - Bela Vista" there, the usual Brazilian
// way, and splits such a line back into street, number and district when reading.
import { displayName, isWebUrl } from "../../shared/contact.ts";
import { isPartialDate, partialDate } from "../../shared/dates.ts";
import {
  LIMITS,
  type Address,
  type AddressLabel,
  type ContactDate,
  type Email,
  type EmailLabel,
  type ExportContact,
  type Phone,
  type PhoneLabel,
  type Website,
} from "../../shared/protocol.ts";

export interface VcardRead {
  contacts: ExportContact[];
  /** cards with nothing to keep (no name, company, phone or email) */
  skipped: number;
  /** cards that had more phones, emails, … than Vinr keeps; the first ones were kept */
  trimmed: number;
  /** properties Vinr doesn't keep, such as PHOTO, with how many cards had them */
  ignored: Map<string, number>;
}

interface Line {
  /** "item1" in "item1.TEL" (Apple ties a label to a property that way), lower case */
  group: string;
  name: string;
  /** parameter names in upper case; TYPE values in upper case, one per entry */
  params: Map<string, string[]>;
  value: string;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────

/** The file's lines, folded lines joined (and 2.1's quoted-printable soft breaks). */
function logicalLines(text: string): string[] {
  const raw = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of raw) {
    const last = lines.length - 1;
    if ((line.startsWith(" ") || line.startsWith("\t")) && last >= 0) {
      lines[last] += line.slice(1);
    } else if (last >= 0 && /QUOTED-PRINTABLE/i.test(lines[last]!.split(":")[0]!) && lines[last]!.endsWith("=")) {
      lines[last] = lines[last]!.slice(0, -1) + line;
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** Splits at a character not escaped by a backslash and not inside double quotes. */
function splitUnescaped(s: string, sep: string, quotes = false): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (quotes && ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (ch === sep && !quoted) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

const unescape = (s: string) => s.replace(/\\([nN,;:\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

function decodeQuotedPrintable(s: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Not escaped: plain ASCII, or text in the same charset as the rest.
      for (const b of new TextEncoder().encode(s[i]!)) bytes.push(b);
    }
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

function parseLine(line: string): Line | null {
  const colon = splitUnescaped(line, ":", true);
  if (colon.length < 2) return null;
  const [head, ...rest] = colon;
  let value = rest.join(":");
  const [nameWithGroup, ...paramParts] = splitUnescaped(head!, ";", true);
  const dot = nameWithGroup!.lastIndexOf(".");
  const group = dot === -1 ? "" : nameWithGroup!.slice(0, dot).toLowerCase();
  const name = nameWithGroup!.slice(dot + 1).toUpperCase();
  const params = new Map<string, string[]>();
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    // vCard 2.1 writes bare types: TEL;CELL;VOICE:…
    const key = eq === -1 ? (/^(QUOTED-PRINTABLE|BASE64|B|8BIT)$/i.test(p) ? "ENCODING" : "TYPE") : p.slice(0, eq);
    const values = (eq === -1 ? p : p.slice(eq + 1))
      .replace(/^"|"$/g, "")
      .split(",")
      .map((v) => v.trim().replace(/^"|"$/g, ""));
    const k = key.toUpperCase();
    params.set(k, [...(params.get(k) ?? []), ...(k === "TYPE" ? values.map((v) => v.toUpperCase()) : values)]);
  }
  if (params.get("ENCODING")?.some((e) => /^QUOTED-PRINTABLE$/i.test(e))) {
    value = decodeQuotedPrintable(value, params.get("CHARSET")?.[0] ?? "utf-8");
  }
  return { group, name, params, value };
}

/** Apple's labels: "_$!<Anniversary>!$_" → "Anniversary"; custom ones as they are. */
const appleLabel = (label: string) => label.replace(/^_\$!<(.*)>!\$_$/, "$1");

/** A date as vCard writes it, as YYYY-MM-DD or --MM-DD; null if it isn't one. */
export function vcardDate(value: string, omitYear?: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(v);
  if (m) {
    // iPhones store a birthday without its year in year 1604, and say so.
    const year = m[1] === omitYear || m[1] === "1604" ? null : Number(m[1]);
    const date = partialDate(year, Number(m[2]), Number(m[3]));
    return isPartialDate(date) ? date : null;
  }
  m = /^--(\d{2})-?(\d{2})$/.exec(v);
  if (m) {
    const date = `--${m[1]}-${m[2]}`;
    return isPartialDate(date) ? date : null;
  }
  return null;
}

/** "Avenida Paulista, 1000 - Bela Vista" → street, number and district. */
export function splitStreet(line: string): { street: string; number: string; district: string } {
  const m = /^(.+?),\s*(\d+[A-Za-z]?|[Ss]\/[Nn]|[Kk]m\s*\d+)\s*(?:-\s*(.+))?$/.exec(line.trim());
  if (!m) return { street: line.trim(), number: "", district: "" };
  return { street: m[1]!.trim(), number: m[2]!, district: m[3]?.trim() ?? "" };
}

const cut = (s: string, max: number) => s.trim().slice(0, max);

const hasType = (l: Line, ...types: string[]) => types.some((t) => l.params.get("TYPE")?.includes(t));

function phoneLabel(l: Line, label: string): PhoneLabel {
  const lower = label.toLowerCase();
  if (hasType(l, "CELL", "IPHONE", "MOBILE") || /mobile|cell|celular|iphone/.test(lower)) return "mobile";
  if (hasType(l, "WORK") || /work|trabalho/.test(lower)) return "work";
  if (hasType(l, "HOME") || /home|casa/.test(lower)) return "home";
  return "other";
}

function placeLabel(l: Line, label: string): EmailLabel & AddressLabel {
  const lower = label.toLowerCase();
  if (hasType(l, "WORK") || /work|trabalho/.test(lower)) return "work";
  if (hasType(l, "HOME") || /home|casa/.test(lower)) return "home";
  return "other";
}

/** Reads every card of a vCard file. */
export function parseVcards(text: string): VcardRead {
  const result: VcardRead = { contacts: [], skipped: 0, trimmed: 0, ignored: new Map() };
  let card: Line[] | null = null;
  for (const raw of logicalLines(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN" && line.value.toUpperCase() === "VCARD") card = [];
    else if (line.name === "END" && line.value.toUpperCase() === "VCARD") {
      if (card) readCard(card, result);
      card = null;
    } else card?.push(line);
  }
  return result;
}

const KNOWN = new Set([
  "VERSION",
  "N",
  "FN",
  "NICKNAME",
  "ORG",
  "TITLE",
  "BDAY",
  "ANNIVERSARY",
  "X-ANNIVERSARY",
  "X-ABDATE",
  "X-ABLABEL",
  "TEL",
  "EMAIL",
  "ADR",
  "URL",
  "NOTE",
  "CATEGORIES",
  "PRODID",
  "REV",
  "UID",
  "KIND",
  "X-ABUID",
]);

function readCard(lines: Line[], result: VcardRead): void {
  const labels = new Map<string, string>();
  for (const l of lines) if (l.name === "X-ABLABEL" && l.group) labels.set(l.group, appleLabel(unescape(l.value)));
  const labelOf = (l: Line) => (l.group && labels.get(l.group)) || "";

  const c: ExportContact = {
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
    favorite: false,
    groups: [],
  };
  let fullName = "";
  const memos: string[] = [];
  let trimmed = false;
  const push = <T>(list: T[], max: number, row: T) => {
    if (list.length < max) list.push(row);
    else trimmed = true;
  };

  for (const l of lines) {
    const text = unescape(l.value).trim();
    switch (l.name) {
      case "N": {
        const [family = "", given = "", additional = ""] = splitUnescaped(l.value, ";").map((s) => unescape(s).trim());
        c.lastName = cut(family, LIMITS.nameChars);
        c.firstName = cut([given, additional].filter(Boolean).join(" "), LIMITS.nameChars);
        break;
      }
      case "FN":
        fullName = text;
        break;
      case "NICKNAME":
        c.nickname ||= cut(unescape(splitUnescaped(l.value, ",")[0]!), LIMITS.nameChars);
        break;
      case "ORG":
        c.company ||= cut(unescape(splitUnescaped(l.value, ";")[0]!), LIMITS.fieldChars);
        break;
      case "TITLE":
        c.title ||= cut(text, LIMITS.fieldChars);
        break;
      case "BDAY":
        c.birthday ??= vcardDate(text, l.params.get("X-APPLE-OMIT-YEAR")?.[0]);
        break;
      case "ANNIVERSARY":
      case "X-ANNIVERSARY":
      case "X-ABDATE": {
        const date = vcardDate(text, l.params.get("X-APPLE-OMIT-YEAR")?.[0]);
        const label = l.name === "X-ABDATE" ? labelOf(l) : "Anniversary";
        if (date) push(c.dates, LIMITS.dates, { label: cut(label, LIMITS.fieldChars), date } satisfies ContactDate);
        break;
      }
      case "TEL": {
        const number = cut(text.replace(/^tel:/i, ""), LIMITS.fieldChars);
        if (/\d/.test(number))
          push(c.phones, LIMITS.phones, { label: phoneLabel(l, labelOf(l)), number, whatsapp: false } satisfies Phone);
        break;
      }
      case "EMAIL": {
        const address = text.replace(/^mailto:/i, "");
        if (/^[^\s@]+@[^\s@]+$/.test(address) && address.length <= LIMITS.fieldChars) {
          push(c.emails, LIMITS.emails, { label: placeLabel(l, labelOf(l)), address } satisfies Email);
        }
        break;
      }
      case "ADR": {
        const [pobox = "", ext = "", streetLine = "", city = "", state = "", postalCode = "", country = ""] =
          splitUnescaped(l.value, ";").map((s) => unescape(s).trim());
        const { street, number, district } = splitStreet(streetLine.replace(/\s*\n\s*/g, ", "));
        const address: Address = {
          label: placeLabel(l, labelOf(l)),
          street,
          number,
          complement: [ext, pobox].filter(Boolean).join(", "),
          district,
          city,
          state,
          postalCode,
          country,
        };
        for (const k of Object.keys(address) as (keyof Address)[]) {
          if (k !== "label") address[k] = cut(address[k], LIMITS.fieldChars);
        }
        if (Object.entries(address).some(([k, v]) => k !== "label" && v)) push(c.addresses, LIMITS.addresses, address);
        break;
      }
      case "URL": {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
        if (text && isWebUrl(url) && url.length <= LIMITS.urlChars) {
          const label = labelOf(l) || (l.params.get("TYPE")?.[0] ?? "");
          const nice = label.charAt(0) + label.slice(1).toLowerCase();
          push(c.websites, LIMITS.websites, { label: cut(nice, LIMITS.fieldChars), url } satisfies Website);
        }
        break;
      }
      case "NOTE":
        if (text) memos.push(text);
        break;
      case "CATEGORIES":
        for (const raw of splitUnescaped(l.value, ",")) {
          const name = cut(unescape(raw), LIMITS.groupNameChars);
          // Google's own markers: everyone is in myContacts, and starred ones are favourites.
          if (name.toLowerCase() === "starred") c.favorite = true;
          else if (name && name.toLowerCase() !== "mycontacts" && !c.groups.includes(name)) c.groups.push(name);
        }
        break;
      default:
        if (!KNOWN.has(l.name)) result.ignored.set(l.name, (result.ignored.get(l.name) ?? 0) + 1);
    }
  }

  c.memo = memos.join("\n\n").replace(/\r\n?/g, "\n").slice(0, LIMITS.memoChars);
  // FN is the name as shown; a card without N may still have one there. (Vinr writes the nickname
  // or company there for a contact without a name: that is no first name.)
  if (!c.firstName && !c.lastName && fullName !== c.nickname && fullName !== c.company) {
    c.firstName = cut(fullName, LIMITS.nameChars);
  }
  // No name at all: called by the number or address, so the card isn't lost.
  if (!c.firstName && !c.lastName && !c.nickname && !c.company) {
    const fallback = c.emails[0]?.address ?? c.phones[0]?.number;
    if (!fallback) {
      result.skipped++;
      return;
    }
    c.nickname = cut(fallback, LIMITS.nameChars);
  }
  if (trimmed) result.trimmed++;
  result.contacts.push(c);
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────

const escapeText = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");

/** Folds a line to at most 75 bytes, never inside a character; continuations start with a space. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    // The first line has 75 bytes; the others 74 after their leading space.
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const PHONE_TYPES: Record<PhoneLabel, string> = {
  mobile: "CELL",
  work: "WORK,VOICE",
  home: "HOME,VOICE",
  other: "VOICE",
};
const PLACE_TYPES: Record<EmailLabel, string> = { home: "HOME", work: "WORK", other: "OTHER" };

/** The street line: "Avenida Paulista, 1000 - Bela Vista". */
export function streetLine(a: Address): string {
  let line = a.street;
  if (a.number) line = line ? `${line}, ${a.number}` : a.number;
  if (a.district) line = line ? `${line} - ${a.district}` : a.district;
  return line;
}

/** One vCard 3.0 card. */
export function writeVcard(c: ExportContact): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  const add = (line: string) => lines.push(fold(line));
  let item = 0;
  const labelled = (property: string, label: string) => {
    if (!label) return add(property);
    item++;
    add(`item${item}.${property}`);
    add(`item${item}.X-ABLabel:${escapeText(label)}`);
  };

  add(`N:${[c.lastName, c.firstName, "", "", ""].map(escapeText).join(";")}`);
  add(`FN:${escapeText(displayName(c))}`);
  if (c.nickname) add(`NICKNAME:${escapeText(c.nickname)}`);
  if (c.company) add(`ORG:${escapeText(c.company)}`);
  if (c.title) add(`TITLE:${escapeText(c.title)}`);
  if (c.birthday) add(`BDAY:${c.birthday}`);
  for (const p of c.phones) add(`TEL;TYPE=${PHONE_TYPES[p.label]}:${escapeText(p.number)}`);
  for (const e of c.emails) add(`EMAIL;TYPE=INTERNET,${PLACE_TYPES[e.label]}:${escapeText(e.address)}`);
  for (const a of c.addresses) {
    const parts = ["", a.complement, streetLine(a), a.city, a.state, a.postalCode, a.country];
    add(`ADR;TYPE=${PLACE_TYPES[a.label]}:${parts.map(escapeText).join(";")}`);
  }
  for (const w of c.websites) labelled(`URL:${escapeText(w.url)}`, w.label);
  for (const d of c.dates) labelled(`X-ABDATE:${d.date}`, d.label);
  if (c.memo) add(`NOTE:${escapeText(c.memo)}`);
  if (c.groups.length > 0) add(`CATEGORIES:${c.groups.map(escapeText).join(",")}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** A .vcf file with every card. */
export const writeVcards = (contacts: readonly ExportContact[]) =>
  contacts.map(writeVcard).join("\r\n") + (contacts.length > 0 ? "\r\n" : "");

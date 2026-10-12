// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Vinr-User";

export const LIMITS = {
  /** first name, last name, nickname */
  nameChars: 100,
  /** company, job title, a label, a phone number, an email address, each part of an address */
  fieldChars: 200,
  urlChars: 2000,
  memoChars: 20_000,
  phones: 5,
  emails: 5,
  addresses: 3,
  websites: 5,
  dates: 5,
  /** contacts per user, recycle bin included */
  contacts: 20_000,
  groups: 100,
  groupNameChars: 50,
  queryChars: 200,
  /** contacts in one import */
  importContacts: 20_000,
} as const;

/** How long a deleted contact stays in the recycle bin. */
export const BIN_DAYS = 30;

/** The colours a group can have. The page maps each to fixed Tailwind classes. */
export const COLORS = ["teal", "sky", "violet", "rose", "amber", "emerald", "orange", "stone"] as const;
export type Color = (typeof COLORS)[number];

export const PHONE_LABELS = ["mobile", "work", "home", "other"] as const;
export type PhoneLabel = (typeof PHONE_LABELS)[number];

export const EMAIL_LABELS = ["home", "work", "other"] as const;
export type EmailLabel = (typeof EMAIL_LABELS)[number];

export const ADDRESS_LABELS = ["home", "work", "other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export const LABEL_NAMES: Record<PhoneLabel | EmailLabel | AddressLabel, string> = {
  mobile: "Mobile",
  work: "Work",
  home: "Home",
  other: "Other",
};

export interface Phone {
  label: PhoneLabel;
  /** as typed: "+55 11 98765-4321", "(11) 3333-4444" */
  number: string;
  /** reachable on WhatsApp */
  whatsapp: boolean;
}

export interface Email {
  label: EmailLabel;
  address: string;
}

/** A postal address, Brazilian style. Every part may be empty. */
export interface Address {
  label: AddressLabel;
  street: string;
  number: string;
  complement: string;
  /** bairro */
  district: string;
  city: string;
  /** UF: "SP" */
  state: string;
  /** CEP: "01310-100" */
  postalCode: string;
  country: string;
}

export interface Website {
  /** free text: "LinkedIn", "Blog"; may be empty */
  label: string;
  /** http:// or https:// only */
  url: string;
}

/** A date to remember (an anniversary, …). */
export interface ContactDate {
  /** free text: "Anniversary"; may be empty */
  label: string;
  /** YYYY-MM-DD, or --MM-DD when the year isn't known */
  date: string;
}

/**
 * What a contact holds, as the editor sends it (POST, and PUT with rev). Being a favourite isn't
 * part of it: the star changes that on its own (PATCH), so it never conflicts with an edit.
 */
export interface ContactFields {
  firstName: string;
  lastName: string;
  nickname: string;
  company: string;
  title: string;
  /** YYYY-MM-DD, --MM-DD when the year isn't known, or null */
  birthday: string | null;
  /** the first one is the primary one */
  phones: Phone[];
  emails: Email[];
  addresses: Address[];
  websites: Website[];
  dates: ContactDate[];
  memo: string;
  groupIds: string[];
}

/** POST /api/contacts */
export interface ContactCreate extends ContactFields {
  favorite?: boolean;
}

export interface Contact extends ContactFields {
  id: string;
  favorite: boolean;
  /** changes with every save (from one counter for the whole database) */
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** set while the contact is in the recycle bin */
  deletedAt: string | null;
}

/** A contact as the list shows it (GET /api/contacts): enough for the list and Upcoming. */
export interface ContactSummary {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
  company: string;
  title: string;
  favorite: boolean;
  groupIds: string[];
  /** the primary phone number and email address, or "" */
  phone: string;
  email: string;
  birthday: string | null;
  dates: ContactDate[];
  rev: number;
  deletedAt: string | null;
}

/** PUT /api/contacts/:id */
export interface ContactWrite extends ContactFields {
  /** the rev the editor started from. 409 { code: "conflict", contact } if it changed since. */
  rev: number;
}

/** POST and PUT /api/contacts answer this. */
export interface ContactSaved {
  id: string;
  rev: number;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  color: Color;
  /** contacts in it, recycle bin left out */
  members: number;
}

/** POST /api/groups; PATCH takes any of the two. */
export interface GroupFields {
  name: string;
  color: Color;
}

export interface Settings {
  /** the list sorts, and shows names, by first or last name */
  sortBy: "first" | "last";
  /** digits only, without "+": added to numbers without "+" for WhatsApp links */
  countryCode: string;
}

export const DEFAULT_SETTINGS: Settings = { sortBy: "first", countryCode: "55" };

export type ErrorCode = "invalid" | "not-found" | "conflict" | "exists" | "too-many" | "not-in-bin" | "other-user";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
  /** with "conflict": the contact as it is now */
  contact?: Contact;
}

/** GET /api/export, POST /api/import: every contact (recycle bin left out), the groups and settings. */
export interface ExportFile {
  format: "vinr";
  version: 1;
  exportedAt: string;
  groups: GroupFields[];
  contacts: ExportContact[];
  settings?: Settings;
}

/** A contact in an export file: groups by name instead of id. */
export interface ExportContact extends Omit<ContactFields, "groupIds"> {
  favorite: boolean;
  groups: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** POST /api/import answers what it did. */
export interface ImportResult {
  /** new contacts */
  added: number;
  /** contacts that matched one already here and gave it something it lacked */
  merged: number;
  /** contacts already here with nothing new */
  unchanged: number;
  /** new groups */
  groups: number;
}

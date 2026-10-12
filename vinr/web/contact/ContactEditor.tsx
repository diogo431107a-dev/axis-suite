import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { dateParts, isPartialDate, partialDate } from "../../shared/dates.ts";
import {
  ADDRESS_LABELS,
  EMAIL_LABELS,
  LABEL_NAMES,
  LIMITS,
  PHONE_LABELS,
  type Address,
  type Contact,
  type ContactFields,
  type Email,
  type Group,
  type Phone,
  type Website,
} from "../../shared/protocol.ts";
import { GROUP_COLORS } from "../colors.ts";
import { setLeaveGuard, type Route } from "../nav.ts";
import { field, iconButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

/** What saving answered: done, refused with a reason, or changed elsewhere meanwhile. */
export type SaveOutcome =
  { kind: "saved" } | { kind: "error"; message: string } | { kind: "conflict"; theirs: Contact };

interface ContactEditorProps {
  /** the contact to change; null for a new one */
  contact: Contact | null;
  groups: Group[];
  /** groups a new contact starts in (the one being looked at) */
  startGroups?: string[];
  /** the route this editor is on: going there again isn't leaving */
  here: Route;
  onSave: (fields: ContactFields, rev: number) => Promise<SaveOutcome>;
  onCancel: () => void;
}

interface DateInput {
  day: string;
  month: string;
  year: string;
}

interface Form {
  firstName: string;
  lastName: string;
  nickname: string;
  company: string;
  title: string;
  birthday: DateInput;
  phones: Phone[];
  emails: Email[];
  addresses: Address[];
  websites: Website[];
  dates: { label: string; date: DateInput }[];
  memo: string;
  groupIds: string[];
}

const NO_DATE: DateInput = { day: "", month: "", year: "" };
const EMPTY_ADDRESS: Address = {
  label: "home",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
};

function dateInput(date: string | null): DateInput {
  if (!date) return NO_DATE;
  const { year, month, day } = dateParts(date);
  return { day: String(day), month: String(month), year: year === null ? "" : String(year) };
}

/** The date typed, "" when it is left empty, or null when it isn't a date. */
function dateValue(d: DateInput): string | null {
  if (!d.day && !d.month && !d.year) return "";
  if (!d.day || !d.month || (d.year && !/^\d{4}$/.test(d.year))) return null;
  const date = partialDate(d.year ? Number(d.year) : null, Number(d.month), Number(d.day));
  return isPartialDate(date) ? date : null;
}

function formOf(c: Contact | null, startGroups: string[]): Form {
  return {
    firstName: c?.firstName ?? "",
    lastName: c?.lastName ?? "",
    nickname: c?.nickname ?? "",
    company: c?.company ?? "",
    title: c?.title ?? "",
    birthday: dateInput(c?.birthday ?? null),
    // A new contact starts with a row for its phone and email.
    phones: c?.phones.map((p) => ({ ...p })) ?? [{ label: "mobile", number: "", whatsapp: false }],
    emails: c?.emails.map((e) => ({ ...e })) ?? [{ label: "home", address: "" }],
    addresses: c?.addresses.map((a) => ({ ...a })) ?? [],
    websites: c?.websites.map((w) => ({ ...w })) ?? [],
    dates: c?.dates.map((d) => ({ label: d.label, date: dateInput(d.date) })) ?? [],
    memo: c?.memo ?? "",
    groupIds: c?.groupIds ?? startGroups,
  };
}

/** What the form holds, as the API takes it, or the first problem with it. */
function fieldsOf(f: Form): ContactFields | string {
  const birthday = dateValue(f.birthday);
  if (birthday === null) return "The birthday isn't a date (day and month, and the year if you know it).";
  const dates: ContactFields["dates"] = [];
  for (const d of f.dates) {
    const date = dateValue(d.date);
    if (date === null) return `${d.label || "A date"} isn't a date.`;
    if (date) dates.push({ label: d.label.trim(), date });
    else if (d.label.trim()) return `${d.label.trim()} has no date.`;
  }
  const fields: ContactFields = {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    nickname: f.nickname.trim(),
    company: f.company.trim(),
    title: f.title.trim(),
    birthday: birthday || null,
    phones: f.phones.filter((p) => p.number.trim()).map((p) => ({ ...p, number: p.number.trim() })),
    emails: f.emails.filter((e) => e.address.trim()).map((e) => ({ ...e, address: e.address.trim() })),
    addresses: f.addresses.filter((a) =>
      Object.entries(a).some(([k, v]) => k !== "label" && typeof v === "string" && v.trim()),
    ),
    websites: f.websites.filter((w) => w.url.trim()).map((w) => ({ label: w.label.trim(), url: w.url.trim() })),
    dates,
    memo: f.memo.trimEnd(),
    groupIds: [...f.groupIds].sort(),
  };
  if (!fields.firstName && !fields.lastName && !fields.nickname && !fields.company) {
    return "Give the contact a name or a company.";
  }
  return fields;
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, i, 1))),
);

function DateFields({ value, onChange, id }: { value: DateInput; onChange: (d: DateInput) => void; id: string }) {
  const select = field;
  return (
    <div className="flex flex-wrap gap-2">
      <select
        id={id}
        aria-label="Day"
        value={value.day}
        onChange={(e) => onChange({ ...value, day: e.target.value })}
        className={select}
      >
        <option value="">Day</option>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
      <select
        aria-label="Month"
        value={value.month}
        onChange={(e) => onChange({ ...value, month: e.target.value })}
        className={select}
      >
        <option value="">Month</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1)}>
            {m}
          </option>
        ))}
      </select>
      <input
        aria-label="Year (optional)"
        inputMode="numeric"
        maxLength={4}
        placeholder="Year"
        value={value.year}
        onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, "") })}
        className={`${field} w-20`}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-stone-400 uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

interface RowsProps<T> {
  rows: T[];
  max: number;
  /** "Add phone" */
  addText: string;
  blank: () => T;
  onChange: (rows: T[]) => void;
  render: (row: T, set: (row: T) => void, index: number) => ReactNode;
  /** the first row is the primary one: say so */
  primary?: boolean;
}

/** A list of rows that can be added, removed and moved up and down. */
function Rows<T>({ rows, max, addText, blank, onChange, render, primary }: RowsProps<T>) {
  const move = (i: number, by: number) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            {render(row, (r) => onChange(rows.map((x, k) => (k === i ? r : x))), i)}
            {primary && i === 0 && rows.length > 1 && <p className="mt-0.5 text-xs text-stone-400">Primary</p>}
          </div>
          {rows.length > 1 && (
            <>
              <button
                type="button"
                className={iconButton}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Move up"
                title="Move up"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={iconButton}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
                title="Move down"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            className={iconButton}
            onClick={() => onChange(rows.filter((_, k) => k !== i))}
            aria-label="Remove"
            title="Remove"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline disabled:text-stone-300 disabled:no-underline"
        disabled={rows.length >= max}
        onClick={() => onChange([...rows, blank()])}
        title={rows.length >= max ? `At most ${max}` : undefined}
      >
        <Plus className="h-4 w-4" aria-hidden /> {addText}
      </button>
    </>
  );
}

function LabelSelect<T extends keyof typeof LABEL_NAMES>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      aria-label="Label"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`${field} w-28 shrink-0`}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {LABEL_NAMES[o]}
        </option>
      ))}
    </select>
  );
}

/** The contact form: a new contact, or changes to one. Saves only when told to. */
export function ContactEditor({ contact, groups, startGroups = [], here, onSave, onCancel }: ContactEditorProps) {
  const [base, setBase] = useState(contact);
  const [form, setForm] = useState(() => formOf(contact, startGroups));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // While a save is under way, the page may move on to the saved contact without asking.
  const saving = useRef(false);

  const initial = useMemo(() => JSON.stringify(formOf(base, startGroups)), [base, startGroups]);
  const dirty = JSON.stringify(form) !== initial;

  // Unsaved changes: ask before leaving, here or by closing the tab.
  const hereRef = useRef(here);
  hereRef.current = here;
  useEffect(() => {
    if (!dirty) return;
    const sameView = (next: Route) =>
      next.kind === "contacts" &&
      hereRef.current.kind === "contacts" &&
      JSON.stringify(next.open) === JSON.stringify(hereRef.current.open);
    setLeaveGuard(
      (next) => saving.current || sameView(next) || window.confirm("Discard your changes to this contact?"),
    );
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  // Ctrl+S saves; Esc cancels (asking first if something changed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      } else if (e.key === "Escape" && !(e.target as HTMLElement).closest("dialog")) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const textField = (key: "firstName" | "lastName" | "nickname" | "company" | "title", name: string, max: number) => (
    <div>
      <label htmlFor={`f-${key}`} className={label}>
        {name}
      </label>
      <input
        id={`f-${key}`}
        autoFocus={key === "firstName" && !contact}
        value={form[key]}
        maxLength={max}
        onChange={(e) => set(key, e.target.value)}
        className={textInput}
      />
    </div>
  );

  async function save(rev: number) {
    const fields = fieldsOf(form);
    if (typeof fields === "string") return setError(fields);
    setBusy(true);
    setError("");
    saving.current = true;
    const outcome = await onSave(fields, rev).finally(() => (saving.current = false));
    setBusy(false);
    if (outcome.kind === "error") setError(outcome.message);
    else if (outcome.kind === "conflict") setConflict(outcome.theirs);
  }

  return (
    <form
      ref={formRef}
      className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5 sm:px-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save(base?.rev ?? 0);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-stone-900">{contact ? "Edit contact" : "New contact"}</h1>
      </div>

      {conflict && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            This contact was changed somewhere else (another tab or device) while you were editing it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setBase(conflict);
                setForm(formOf(conflict, startGroups));
                setConflict(null);
              }}
            >
              Load theirs
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                const theirs = conflict;
                setConflict(null);
                void save(theirs.rev);
              }}
            >
              Save mine anyway
            </button>
          </div>
        </div>
      )}

      <Section title="Name">
        <div className="grid gap-3 sm:grid-cols-2">
          {textField("firstName", "First name", LIMITS.nameChars)}
          {textField("lastName", "Last name", LIMITS.nameChars)}
          {textField("nickname", "Nickname", LIMITS.nameChars)}
        </div>
      </Section>

      <Section title="Work">
        <div className="grid gap-3 sm:grid-cols-2">
          {textField("company", "Company", LIMITS.fieldChars)}
          {textField("title", "Job title", LIMITS.fieldChars)}
        </div>
      </Section>

      <Section title="Phones">
        <Rows
          rows={form.phones}
          max={LIMITS.phones}
          addText="Add phone"
          primary
          blank={(): Phone => ({ label: "mobile", number: "", whatsapp: false })}
          onChange={(rows) => set("phones", rows)}
          render={(p, setRow) => (
            <div className="flex flex-wrap items-center gap-2">
              <LabelSelect value={p.label} options={PHONE_LABELS} onChange={(l) => setRow({ ...p, label: l })} />
              <input
                aria-label="Phone number"
                type="tel"
                value={p.number}
                maxLength={LIMITS.fieldChars}
                placeholder="(11) 98765-4321"
                onChange={(e) => setRow({ ...p, number: e.target.value })}
                className={`${field} min-w-40 flex-1`}
              />
              <label className="flex items-center gap-1 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={p.whatsapp}
                  onChange={(e) => setRow({ ...p, whatsapp: e.target.checked })}
                  className="accent-teal-600"
                />
                WhatsApp
              </label>
            </div>
          )}
        />
      </Section>

      <Section title="Emails">
        <Rows
          rows={form.emails}
          max={LIMITS.emails}
          addText="Add email"
          primary
          blank={(): Email => ({ label: "home", address: "" })}
          onChange={(rows) => set("emails", rows)}
          render={(em, setRow) => (
            <div className="flex gap-2">
              <LabelSelect value={em.label} options={EMAIL_LABELS} onChange={(l) => setRow({ ...em, label: l })} />
              <input
                aria-label="Email address"
                type="email"
                value={em.address}
                maxLength={LIMITS.fieldChars}
                placeholder="name@example.com"
                onChange={(e) => setRow({ ...em, address: e.target.value })}
                className={`${field} min-w-0 flex-1`}
              />
            </div>
          )}
        />
      </Section>

      <Section title="Addresses">
        <Rows
          rows={form.addresses}
          max={LIMITS.addresses}
          addText="Add address"
          blank={() => ({ ...EMPTY_ADDRESS })}
          onChange={(rows) => set("addresses", rows)}
          render={(a, setRow) => {
            const part = (key: Exclude<keyof Address, "label">, placeholder: string, width = "") => (
              <input
                aria-label={placeholder}
                placeholder={placeholder}
                value={a[key]}
                maxLength={LIMITS.fieldChars}
                onChange={(e) => setRow({ ...a, [key]: e.target.value })}
                className={`${width ? field : textInput} ${width}`}
              />
            );
            return (
              <div className="space-y-2 rounded-lg border border-stone-200 p-2">
                <LabelSelect value={a.label} options={ADDRESS_LABELS} onChange={(l) => setRow({ ...a, label: l })} />
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  {part("street", "Street")}
                  {part("number", "Number")}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {part("complement", "Complement (apt, block…)")}
                  {part("district", "District (bairro)")}
                </div>
                <div className="grid grid-cols-[1fr_5rem] gap-2">
                  {part("city", "City")}
                  {part("state", "State")}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {part("postalCode", "Postal code (CEP)")}
                  {part("country", "Country")}
                </div>
              </div>
            );
          }}
        />
      </Section>

      <Section title="Birthday and dates">
        <div>
          <label htmlFor="f-birthday" className={label}>
            Birthday (the year is optional)
          </label>
          <DateFields id="f-birthday" value={form.birthday} onChange={(d) => set("birthday", d)} />
        </div>
        <Rows
          rows={form.dates}
          max={LIMITS.dates}
          addText="Add a date (anniversary…)"
          blank={() => ({ label: "", date: NO_DATE })}
          onChange={(rows) => set("dates", rows)}
          render={(d, setRow, i) => (
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="What the date is"
                placeholder="Anniversary"
                value={d.label}
                maxLength={LIMITS.fieldChars}
                onChange={(e) => setRow({ ...d, label: e.target.value })}
                className={`${field} w-40`}
              />
              <DateFields id={`f-date-${i}`} value={d.date} onChange={(date) => setRow({ ...d, date })} />
            </div>
          )}
        />
      </Section>

      <Section title="Websites">
        <Rows
          rows={form.websites}
          max={LIMITS.websites}
          addText="Add website"
          blank={() => ({ label: "", url: "" })}
          onChange={(rows) => set("websites", rows)}
          render={(w, setRow) => (
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="What the website is"
                placeholder="LinkedIn, blog…"
                value={w.label}
                maxLength={LIMITS.fieldChars}
                onChange={(e) => setRow({ ...w, label: e.target.value })}
                className={`${field} w-40`}
              />
              <input
                aria-label="Web address"
                type="url"
                placeholder="https://…"
                value={w.url}
                maxLength={LIMITS.urlChars}
                onChange={(e) => setRow({ ...w, url: e.target.value })}
                className={`${field} min-w-40 flex-1`}
              />
            </div>
          )}
        />
      </Section>

      {groups.length > 0 && (
        <Section title="Groups">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = form.groupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set("groupIds", on ? form.groupIds.filter((id) => id !== g.id) : [...form.groupIds, g.id])
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                    on
                      ? `border-transparent ${GROUP_COLORS[g.color].soft} ${GROUP_COLORS[g.color].text} font-medium`
                      : "border-stone-200 text-stone-500 hover:border-stone-300"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${GROUP_COLORS[g.color].dot}`} aria-hidden />
                  {g.name}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Memo">
        <textarea
          aria-label="Memo"
          rows={5}
          value={form.memo}
          maxLength={LIMITS.memoChars}
          onChange={(e) => set("memo", e.target.value)}
          placeholder="Anything else worth remembering"
          className={textInput}
        />
      </Section>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy || (!!contact && !dirty)}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

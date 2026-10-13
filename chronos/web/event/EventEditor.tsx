import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { addDays, daysBetween } from "../../shared/dates.ts";
import { LIMITS, type CalEvent, type Calendar, type EventFields } from "../../shared/protocol.ts";
import { instantOf, toInstantMs, toWall } from "../../shared/zones.ts";
import { DateField } from "../inputs/DateField.tsx";
import { TimeField } from "../inputs/TimeField.tsx";
import { setLeaveGuard } from "../nav.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

export type SaveOutcome =
  { kind: "saved" } | { kind: "conflict"; theirs: CalEvent } | { kind: "error"; message: string };

interface EventEditorProps {
  /** the event to change; null for a new one */
  event: CalEvent | null;
  /** a new event's day; null: today */
  date: string | null;
  calendars: Calendar[];
  defaultCalendarId: string | null;
  /** minutes a new timed event lasts */
  defaultDuration: number;
  zone: string;
  today: string;
  onSave: (fields: EventFields, rev: number) => Promise<SaveOutcome>;
  onClose: () => void;
}

/** The form as typed: dates and times on the home zone's clock; an all-day event's end is its last day. */
interface Form {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  url: string;
  description: string;
}

function formOf(e: CalEvent, zone: string): Form {
  const common = {
    title: e.title,
    calendarId: e.calendarId,
    location: e.location,
    url: e.url,
    description: e.description,
  };
  if (e.allDay) {
    return {
      ...common,
      allDay: true,
      startDate: e.start,
      startTime: "09:00",
      endDate: addDays(e.end, -1),
      endTime: "10:00",
    };
  }
  const s = toWall(e.start, zone);
  const end = toWall(e.end, zone);
  return { ...common, allDay: false, startDate: s.date, startTime: s.time, endDate: end.date, endTime: end.time };
}

function newForm(date: string, calendarId: string, duration: number, zone: string, today: string): Form {
  // Today: the next whole hour; another day: 09:00.
  let start = toInstantMs(`${date}T09:00`, zone);
  if (date === today) {
    const now = toWall(Date.now(), zone);
    const hour = Math.min(Number(now.time.slice(0, 2)) + 1, 23);
    start = toInstantMs(`${date}T${String(hour).padStart(2, "0")}:00`, zone);
  }
  const s = toWall(start, zone);
  const e = toWall(start + duration * 60_000, zone);
  return {
    title: "",
    calendarId,
    allDay: false,
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
    location: "",
    url: "",
    description: "",
  };
}

/** The event the form describes, or a sentence saying what is wrong. */
function fieldsOf(f: Form, zone: string): EventFields | string {
  if (!f.title.trim()) return "Give the event a title.";
  if (f.allDay) {
    if (f.endDate < f.startDate) return "The last day is before the first.";
    return { ...common(f), allDay: true, start: f.startDate, end: addDays(f.endDate, 1) };
  }
  const start = toInstantMs(`${f.startDate}T${f.startTime}`, zone);
  const end = toInstantMs(`${f.endDate}T${f.endTime}`, zone);
  if (end < start) return "The end is before the start.";
  return { ...common(f), allDay: false, start: instantOf(start), end: instantOf(end) };
}

const common = (f: Form) => ({
  calendarId: f.calendarId,
  title: f.title.trim(),
  location: f.location.trim(),
  url: f.url.trim(),
  description: f.description.trimEnd(),
});

/** Makes or changes an event. Saves on Save or Ctrl+S; leaving with unsaved changes asks first. */
export function EventEditor(props: EventEditorProps) {
  const { event, calendars, zone, today, onSave, onClose } = props;
  const fallbackCalendar =
    calendars.find((c) => c.id === props.defaultCalendarId)?.id ??
    calendars.find((c) => c.visible)?.id ??
    calendars[0]!.id;
  const [initial, setInitial] = useState<Form>(() =>
    event ? formOf(event, zone) : newForm(props.date ?? today, fallbackCalendar, props.defaultDuration, zone, today),
  );
  const [form, setForm] = useState<Form>(initial);
  const [rev, setRev] = useState(event?.rev ?? 0);
  const [error, setError] = useState("");
  const [theirs, setTheirs] = useState<CalEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  /** Whether the form may go: nothing unsaved, or the user agrees to lose it (asked once). */
  const confirmLeave = () => {
    if (!dirtyRef.current) return true;
    if (!window.confirm("Discard your changes to this event?")) return false;
    dirtyRef.current = false;
    return true;
  };

  useEffect(() => {
    setLeaveGuard(confirmLeave);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** A new start moves the end with it, so the event keeps its length. */
  function moveStart(date: string, time: string) {
    setForm((f) => {
      if (f.allDay) {
        const days = daysBetween(f.startDate, f.endDate);
        return { ...f, startDate: date, endDate: addDays(date, Math.max(days, 0)) };
      }
      const length =
        toInstantMs(`${f.endDate}T${f.endTime}`, zone) - toInstantMs(`${f.startDate}T${f.startTime}`, zone);
      const start = toInstantMs(`${date}T${time}`, zone);
      const end = toWall(start + Math.max(length, 0), zone);
      return { ...f, startDate: date, startTime: time, endDate: end.date, endTime: end.time };
    });
  }

  async function save(withRev: number) {
    const fields = fieldsOf(form, zone);
    if (typeof fields === "string") return setError(fields);
    setBusy(true);
    setError("");
    const outcome = await onSave(fields, withRev);
    setBusy(false);
    if (outcome.kind === "saved") {
      dirtyRef.current = false;
      setLeaveGuard(null);
      if (formRef.current) closeDialog(formRef.current);
    } else if (outcome.kind === "conflict") {
      setTheirs(outcome.theirs);
    } else {
      setError(outcome.message);
    }
  }

  const id = (name: string) => `event-${name}`;

  return (
    <Dialog title={event ? "Edit event" : "New event"} onClose={onClose} canClose={confirmLeave} wide>
      <form
        ref={formRef}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(rev);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void save(rev);
          }
        }}
      >
        {theirs && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden /> This event was changed elsewhere.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  const f = formOf(theirs, zone);
                  setInitial(f);
                  setForm(f);
                  setRev(theirs.rev);
                  setTheirs(null);
                }}
              >
                Load theirs
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setRev(theirs.rev);
                  setTheirs(null);
                  void save(theirs.rev);
                }}
              >
                Save mine anyway
              </button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor={id("title")} className={label}>
            Title
          </label>
          <input
            id={id("title")}
            data-autofocus
            maxLength={LIMITS.titleChars}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className={textInput}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor={id("calendar")} className={label}>
              Calendar
            </label>
            <select
              id={id("calendar")}
              value={form.calendarId}
              onChange={(e) => set("calendarId", e.target.value)}
              className={`${textInput} w-auto`}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => set("allDay", e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            All day
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className={label}>{form.allDay ? "First and last day" : `Start and end (${zone})`}</legend>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-xs text-stone-500">{form.allDay ? "From" : "Start"}</span>
            <DateField
              value={form.startDate}
              onChange={(d) => moveStart(d, form.startTime)}
              today={today}
              label="Start date"
            />
            {!form.allDay && (
              <TimeField value={form.startTime} onChange={(t) => moveStart(form.startDate, t)} label="Start time" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-xs text-stone-500">{form.allDay ? "To" : "End"}</span>
            <DateField value={form.endDate} onChange={(d) => set("endDate", d)} today={today} label="End date" />
            {!form.allDay && <TimeField value={form.endTime} onChange={(t) => set("endTime", t)} label="End time" />}
          </div>
        </fieldset>

        <div>
          <label htmlFor={id("location")} className={label}>
            Location
          </label>
          <input
            id={id("location")}
            maxLength={LIMITS.locationChars}
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
            className={textInput}
          />
        </div>
        <div>
          <label htmlFor={id("url")} className={label}>
            Link
          </label>
          <input
            id={id("url")}
            type="url"
            inputMode="url"
            maxLength={LIMITS.urlChars}
            placeholder="https://"
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
            className={textInput}
          />
        </div>
        <div>
          <label htmlFor={id("description")} className={label}>
            Description
          </label>
          <textarea
            id={id("description")}
            rows={4}
            maxLength={LIMITS.descriptionChars}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className={`${textInput} resize-y`}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <span className="hidden text-xs text-stone-400 sm:inline">Ctrl+S saves</span>
          <span className="flex-1" />
          <button
            type="button"
            className={secondaryButton}
            onClick={(e) => confirmLeave() && closeDialog(e.currentTarget)}
          >
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy}>
            {event ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

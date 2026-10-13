import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Menu, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import { addDays, addMonths, monthOf, monthWeeks } from "../shared/dates.ts";
import { writeIcs } from "../shared/ics/write.ts";
import {
  COLORS,
  DEFAULT_SETTINGS,
  type CalEvent,
  type Calendar,
  type CalendarFields,
  type EventFields,
  type EventSaved,
  type Settings,
} from "../shared/protocol.ts";
import { isZone } from "../shared/zones.ts";
import { Sidebar, type SidebarDialog } from "./Sidebar.tsx";
import { AgendaView } from "./agenda/AgendaView.tsx";
import { ApiFailure, api, describeError, query, setPageUser } from "./api.ts";
import { BackupDialog } from "./dialogs/BackupDialog.tsx";
import { CalendarDialog } from "./dialogs/CalendarDialog.tsx";
import { DayDialog } from "./dialogs/DayDialog.tsx";
import { ImportDialog } from "./dialogs/ImportDialog.tsx";
import { SettingsDialog } from "./dialogs/SettingsDialog.tsx";
import { download, fileName } from "./download.ts";
import { EventDialog } from "./event/EventDialog.tsx";
import { EventEditor, type SaveOutcome } from "./event/EventEditor.tsx";
import { useToday } from "./hooks.ts";
import { MonthView } from "./month/MonthView.tsx";
import { go, useRoute, withOpen, type Route, type View } from "./nav.ts";
import { iconButton } from "./ui/buttons.ts";

type DialogState =
  | { kind: "calendar"; calendar?: Calendar }
  | { kind: "import"; into?: Calendar }
  | { kind: "settings" }
  | { kind: "backup" }
  | { kind: "day"; date: string };

interface Notice {
  text: string;
  tone: "info" | "error";
}

/** Days the agenda loads at a time, and at most. */
const AGENDA_STEP = 60;
const AGENDA_MAX = 720;

/** The open event: loading, loaded, or not there. */
type Opened = { id: string; event: CalEvent | null | "missing" };

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [calendars, setCalendars] = useState<Calendar[] | null>(null);
  // The events of the days shown, and which days those are.
  const [loaded, setLoaded] = useState<{ from: string; to: string; events: CalEvent[] } | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  // Goes up after every change: the events shown and the open one follow.
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [agendaDays, setAgendaDays] = useState(AGENDA_STEP);
  const route = useRoute();
  const zone = isZone(settings.homeZone) ? settings.homeZone : browserZone();
  const today = useToday(zone);
  const [miniMonth, setMiniMonth] = useState(() => monthOf(today));

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);

  /** Runs a change; on failure, says why and answers null. */
  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [handleError],
  );

  const reloadCalendars = useCallback(async () => {
    setCalendars(await api<Calendar[]>("/api/calendars"));
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        let s = await api<Settings>("/api/settings");
        // The first time: the home zone is this device's.
        if (!s.homeZone && isZone(browserZone())) {
          s = await api<Settings>("/api/settings", { method: "PUT", body: { ...s, homeZone: browserZone() } });
        }
        setSettings(s);
        await reloadCalendars();
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not load your calendars. Try again in a moment.");
      });
  }, [reloadCalendars]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      reloadCalendars().catch(handleError);
    });
  }, [signedOut, me, reloadCalendars, handleError]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The days the view shows.
  const view = route.view;
  const month = view.kind === "month" ? (view.month ?? monthOf(today)) : null;
  const range = useMemo(() => {
    if (month) {
      const weeks = monthWeeks(month);
      return { from: weeks[0]![0]!, to: addDays(weeks.at(-1)![6]!, 1) };
    }
    return { from: today, to: addDays(today, agendaDays) };
  }, [month, today, agendaDays]);

  useEffect(() => setMiniMonth(month ?? monthOf(today)), [month, today]);

  useEffect(() => {
    if (!me) return;
    let stale = false;
    api<CalEvent[]>(`/api/events${query(range)}`).then(
      (events) => !stale && setLoaded({ ...range, events }),
      (err: unknown) => !stale && handleError(err),
    );
    return () => {
      stale = true;
    };
  }, [me, range, revision, zone, handleError]);

  // The open event, fetched whole.
  const open = route.open;
  const openId = open && open.kind !== "new" ? open.id : null;
  useEffect(() => {
    if (!me || !openId) return setOpened(null);
    let stale = false;
    setOpened((o) => (o?.id === openId ? o : { id: openId, event: null }));
    api<CalEvent>(`/api/events/${openId}`).then(
      (event) => !stale && setOpened({ id: openId, event }),
      (err: unknown) => {
        if (stale) return;
        if (err instanceof ApiFailure && err.status === 404) setOpened({ id: openId, event: "missing" });
        else handleError(err);
      },
    );
    return () => {
      stale = true;
    };
  }, [me, openId, revision, handleError]);

  const calendarById = useMemo(() => new Map((calendars ?? []).map((c) => [c.id, c])), [calendars]);
  // The events of shown calendars, once the ones for these days have come.
  const shown = useMemo(() => {
    if (!loaded || loaded.from !== range.from || loaded.to !== range.to) return null;
    return loaded.events.filter((e) => calendarById.get(e.calendarId)?.visible);
  }, [loaded, range, calendarById]);

  useEffect(() => {
    document.title = month ? `${month} · Chronos` : "Agenda · Chronos";
  }, [month]);

  const toView = useCallback((v: View) => go({ view: v, open: null }), []);
  const newEvent = useCallback(
    (date: string | null) => {
      if (calendars?.length === 0) {
        setNotice({ text: "Make a calendar first (+ beside Calendars), or import an .ics file.", tone: "info" });
        return;
      }
      go(withOpen(route, { kind: "new", date }));
    },
    [calendars, route],
  );

  // Keys, when nobody is typing: N new event, T today, ← → months, M month, A agenda.
  const keys = useRef({ route, month, today, newEvent, toView });
  keys.current = { route, month, today, newEvent, toView };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || target.closest("input, textarea, select, dialog, [contenteditable]")) {
        return;
      }
      const k = keys.current;
      const key = e.key.toLowerCase();
      if (key === "n") k.newEvent(k.month && k.month !== monthOf(k.today) ? `${k.month}-01` : null);
      else if (key === "t") k.toView({ kind: "month", month: null });
      else if (key === "m") k.toView({ kind: "month", month: k.month });
      else if (key === "a") k.toView({ kind: "agenda" });
      else if (k.month && e.key === "ArrowLeft") k.toView({ kind: "month", month: addMonths(k.month, -1) });
      else if (k.month && e.key === "ArrowRight") k.toView({ kind: "month", month: addMonths(k.month, 1) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Changes ──────────────────────────────────────────────────────────────────────────────────

  async function saveEvent(id: string | null, fields: EventFields, rev: number): Promise<SaveOutcome> {
    try {
      if (id) await api<EventSaved>(`/api/events/${id}`, { method: "PUT", body: { ...fields, rev } });
      else await api<EventSaved>("/api/events", { method: "POST", body: fields });
      await reloadCalendars().catch(handleError);
      if (!id)
        setNotice({
          text: `${fields.title} is in ${calendarById.get(fields.calendarId)?.name ?? "the calendar"}.`,
          tone: "info",
        });
      return { kind: "saved" };
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "conflict" && err.body?.event) {
        return { kind: "conflict", theirs: err.body.event };
      }
      handleError(err);
      if (err instanceof SignedOutError) {
        return { kind: "error", message: "Your session has ended. Sign in again (see above), then save." };
      }
      return { kind: "error", message: describeError(err) };
    }
  }

  async function deleteEvent(event: CalEvent): Promise<boolean> {
    const done = await attempt(() => api(`/api/events/${event.id}`, { method: "DELETE" }));
    if (done === null) return false;
    await reloadCalendars().catch(handleError);
    setNotice({ text: `${event.title} is deleted.`, tone: "info" });
    return true;
  }

  async function toggleCalendar(c: Calendar) {
    // Shown at once; put back if it fails.
    const flip = (visible: boolean) =>
      setCalendars((list) => list?.map((x) => (x.id === c.id ? { ...x, visible } : x)) ?? null);
    flip(!c.visible);
    const done = await attempt(() =>
      api<Calendar>(`/api/calendars/${c.id}`, { method: "PATCH", body: { visible: !c.visible } }),
    );
    if (!done) flip(c.visible);
  }

  async function saveCalendar(existing: Calendar | undefined, fields: CalendarFields): Promise<boolean> {
    const saved = await attempt(() =>
      existing
        ? api<Calendar>(`/api/calendars/${existing.id}`, { method: "PATCH", body: fields })
        : api<Calendar>("/api/calendars", { method: "POST", body: fields }),
    );
    if (!saved) return false;
    await reloadCalendars().catch(handleError);
    return true;
  }

  async function deleteCalendar(existing: Calendar): Promise<boolean> {
    const done = await attempt(() => api(`/api/calendars/${existing.id}`, { method: "DELETE" }));
    if (done === null) return false;
    await reloadCalendars().catch(handleError);
    setNotice({ text: `The calendar ${existing.name} is deleted.`, tone: "info" });
    return true;
  }

  async function exportCalendar(c: Calendar) {
    const events = await attempt(() => api<CalEvent[]>(`/api/calendars/${c.id}/events`));
    if (!events) return;
    download(fileName(c.name, "ics"), "text/calendar", writeIcs(c.name, events));
  }

  async function saveSettings(next: Settings): Promise<boolean> {
    const saved = await attempt(() => api<Settings>("/api/settings", { method: "PUT", body: next }));
    if (saved) {
      setSettings(saved);
      setRevision((r) => r + 1);
    }
    return saved !== null;
  }

  // ── Page ─────────────────────────────────────────────────────────────────────────────────────

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!me || !calendars) return <p className="p-8 text-sm text-stone-400">Opening your calendars…</p>;

  const openDialog = (kind: SidebarDialog, calendar?: Calendar) => {
    setNavOpen(false);
    setDialog(kind === "calendar" ? { kind, calendar } : { kind });
  };
  const openEvent = (e: CalEvent) => {
    setDialog(null);
    go(withOpen(route, { kind: "event", id: e.id }));
  };
  const closeOpen = (next: Route["open"] = null) => go(withOpen(route, next));

  let main;
  if (view.kind === "agenda") {
    main = (
      <AgendaView
        today={today}
        days={agendaDays}
        maxDays={AGENDA_MAX}
        zone={zone}
        events={shown}
        calendars={calendarById}
        onOpen={openEvent}
        onMore={() => setAgendaDays((d) => Math.min(d + AGENDA_STEP, AGENDA_MAX))}
      />
    );
  } else {
    main = (
      <MonthView
        month={month!}
        today={today}
        zone={zone}
        events={shown}
        calendars={calendarById}
        onMonth={(m) => toView({ kind: "month", month: m === monthOf(today) ? null : m })}
        onOpen={openEvent}
        onNew={(date) => newEvent(date)}
        onDay={(date) => setDialog({ kind: "day", date })}
      />
    );
  }

  let eventDialog = null;
  if (open?.kind === "event") {
    const event = opened?.id === open.id ? opened.event : null;
    eventDialog = (
      <EventDialog
        key={open.id}
        event={event}
        calendar={event && event !== "missing" ? calendarById.get(event.calendarId) : undefined}
        zone={zone}
        onEdit={() => go(withOpen(route, { kind: "edit", id: open.id }))}
        onDelete={() => (event && event !== "missing" ? deleteEvent(event) : Promise.resolve(false))}
        onClose={() => closeOpen()}
      />
    );
  } else if (open?.kind === "edit") {
    const event = opened?.id === open.id ? opened.event : null;
    if (event === "missing") {
      eventDialog = (
        <EventDialog
          key={open.id}
          event="missing"
          calendar={undefined}
          zone={zone}
          onEdit={() => {}}
          onDelete={() => Promise.resolve(false)}
          onClose={() => closeOpen()}
        />
      );
    } else if (event && calendars.length > 0) {
      eventDialog = (
        <EventEditor
          key={`edit-${open.id}`}
          event={event}
          date={null}
          calendars={calendars}
          defaultCalendarId={settings.defaultCalendarId}
          defaultDuration={settings.defaultDuration}
          zone={zone}
          today={today}
          onSave={(fields, rev) => saveEvent(event.id, fields, rev)}
          onClose={() => closeOpen({ kind: "event", id: open.id })}
        />
      );
    }
  } else if (open?.kind === "new" && calendars.length > 0) {
    eventDialog = (
      <EventEditor
        key={`new-${open.date}`}
        event={null}
        date={open.date}
        calendars={calendars}
        defaultCalendarId={settings.defaultCalendarId}
        defaultDuration={settings.defaultDuration}
        zone={zone}
        today={today}
        onSave={(fields, rev) => saveEvent(null, fields, rev)}
        onClose={() => closeOpen()}
      />
    );
  }

  return (
    <div className="flex h-full bg-stone-50 text-stone-800">
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-stone-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-stone-200 bg-stone-100 transition-transform md:static md:z-auto
          md:w-64 md:shrink-0 md:translate-x-0 ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
      >
        <button
          type="button"
          className={`${iconButton} absolute top-3 right-3 md:hidden`}
          aria-label="Close the menu"
          onClick={() => setNavOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar
          me={me}
          route={route}
          calendars={calendars}
          today={today}
          miniMonth={miniMonth}
          onMiniMonth={setMiniMonth}
          onDay={(date) => {
            setNavOpen(false);
            toView({ kind: "month", month: monthOf(date) === monthOf(today) ? null : monthOf(date) });
          }}
          onNewEvent={() => {
            setNavOpen(false);
            newEvent(null);
          }}
          onToggle={(c) => void toggleCalendar(c)}
          onDialog={openDialog}
          onNavigate={() => setNavOpen(false)}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-3 py-2 md:hidden">
          <button type="button" className={iconButton} aria-label="Menu" onClick={() => setNavOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-stone-800">Chronos</span>
        </div>

        {signedOut && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Your session has ended. What you are editing stays here;
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              sign in again
            </a>
            (in a new tab), then save.
          </div>
        )}

        {calendars.length === 0 && (
          <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
            No calendars yet.{" "}
            <button type="button" className="font-medium underline" onClick={() => openDialog("calendar")}>
              Make one
            </button>{" "}
            or{" "}
            <button type="button" className="font-medium underline" onClick={() => openDialog("import")}>
              import an .ics file
            </button>
            .
          </div>
        )}

        {main}
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${
            notice.tone === "error" ? "bg-red-700 text-white" : "bg-stone-800 text-white"
          }`}
        >
          {notice.text}
        </div>
      )}

      {eventDialog}

      {dialog?.kind === "day" && (
        <DayDialog
          date={dialog.date}
          zone={zone}
          events={shown ?? []}
          calendars={calendarById}
          onOpen={openEvent}
          onNew={() => {
            setDialog(null);
            newEvent(dialog.date);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "calendar" && (
        <CalendarDialog
          calendar={dialog.calendar}
          suggestedColor={COLORS.find((c) => !calendars.some((x) => x.color === c))}
          zone={zone}
          onSave={(fields) => saveCalendar(dialog.calendar, fields)}
          onDelete={dialog.calendar ? () => deleteCalendar(dialog.calendar!) : undefined}
          onExport={dialog.calendar ? () => void exportCalendar(dialog.calendar!) : undefined}
          onImport={dialog.calendar ? () => setDialog({ kind: "import", into: dialog.calendar }) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "import" && (
        <ImportDialog
          key={dialog.into?.id ?? "any"}
          calendars={calendars}
          into={dialog.into}
          zone={zone}
          today={today}
          onImported={() => void reloadCalendars().catch(handleError)}
          onError={handleError}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "settings" && (
        <SettingsDialog
          settings={{ ...settings, homeZone: zone }}
          calendars={calendars}
          onSave={saveSettings}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog
          onRestored={() => {
            void attempt(() => api<Settings>("/api/settings")).then((s) => s && setSettings(s));
            void reloadCalendars().catch(handleError);
          }}
          onError={handleError}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

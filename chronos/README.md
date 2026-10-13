# Chronos

A calendar. Each user has any number of calendars (Personal, Harvest, Moon phases, Formula 1…), each with a colour, which can be shown or hidden; events are made here or imported from iCalendar (`.ics`) files. Chronos has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own calendars and nobody else's.

| Layer    | Technology                                                                  |
| -------- | --------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                            |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                     |
| Database | `/var/lib/chronos/chronos.db` on a server, `data/chronos.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                             |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
  dates.ts           days as YYYY-MM-DD, months, ISO 8601 weeks (Monday first)
  zones.ts           time zones: instants to wall clocks and back, with only Intl
  ics/               reading and writing iCalendar (.ics) files; repeating events unrolled (rrule)
server/
  index.ts           routes, /healthz, removed users' calendars, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  store.ts           the only place calendars and events are read and written; import and its merging
web/
  month/             the month view and how a week is laid out
  agenda/            the days from today on, with their events
  event/             an event, and the form that edits it
  inputs/            date and time fields that write YYYY-MM-DD and HH:MM, and the small month
  dialogs/           calendars, import, settings, backup, a day's events
  format.ts          every date and time the page shows is written here
deploy/
  chronos.service    systemd unit (sandboxed)
  chronos.caddy      Caddy site: /api to the service, everything else from dist/web
```

## How it works

**ISO 8601, never the browser's language.** Dates are `2026-10-13`, times `14:00` on a 24-hour clock, weeks start on Monday and are numbered the ISO way (`2026-W42`; the week with the year's first Thursday is week 1, so 2027-01-01 is in 2026-W53). The date and time fields are plain text fields with a small month to pick from, not the browser's own pickers, which would show `13/10/2026` or `2:00 PM` in some languages.

**Time zones.** A timed event is kept as two instants in UTC. Everything is shown on the clock of one **home zone**, set in Settings (the first time, the device's own). Changing it moves timed events on the screen, not in time: a Formula 1 race at 17:00 UTC shows at 14:00 in America/Sao_Paulo and at 17:00 in Europe/London. **All-day events** are plain dates, with no zone at all, so a full moon or a holiday stays on its day whatever the home zone. An event read from a file remembers the zone the file gave it, and when that zone's clock differs from the home zone, the event shows that time too ("In UTC: 2026-11-08 17:00–19:00"). Changing an event's times here drops it.

**Calendars.** Each has a name (unique, ignoring case), a colour and a show/hide switch (click the calendar in the sidebar); hidden calendars keep their events. Deleting a calendar deletes its events, after asking. Up to 50 calendars and 100,000 events.

**Events** have a title, a start and an end (or a first and a last day, for all-day ones), a location, a link and a description. An event that crosses midnight, or lasts several days, is a bar across those days in the month view. Chronos has no repeating events of its own.

**Saving.** The form saves when you press Create/Save (or Ctrl+S). Closing it with unsaved changes asks first. Every save names the version of the event it was edited from; if the event was saved elsewhere since (another tab, another device), Chronos says so and offers to load that version or to save yours over it.

**Signing out.** If the session ends while someone is editing, a banner asks them to sign in again in a new tab; the form keeps what was typed, ready to save. If a different user signs in (in another tab), the page starts over with that user's calendars: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Importing .ics files

**Import .ics** (sidebar, or a calendar's pencil → _Import .ics into it_) reads the file in the browser, shows how many events it has and the days they span, and imports them into a new calendar (named after the file's `X-WR-CALNAME`) or an existing one.

- **Importing again updates.** Events are matched by their `UID` (and `RECURRENCE-ID`): changed ones are updated, new ones added, nothing is added twice. Importing the same file twice changes nothing. Changes made here to an imported event are replaced by the file's version.
- **Remove events no longer in the file** (when importing into an existing calendar) deletes the calendar's imported events the file doesn't have; events made here stay.
- **Times.** `…Z` is UTC. `TZID=` names a zone: an IANA name (`America/Sao_Paulo`, also inside longer names like `/mozilla.org/…/America/Sao_Paulo`), a Windows name from Outlook (`E. South America Standard Time`), or else the fixed offset of the file's own `VTIMEZONE`. A time with no zone is read in the file's `X-WR-TIMEZONE`, or else the home zone of the day of the import. `DURATION` stands in for a missing end.
- **Repeating events** (`RRULE`, `RDATE`, with `EXDATE` and changed occurrences) are unrolled into separate events, from 2 years before the import to 5 years after, at most 500 per event. A rule is followed on the clock of its own zone, so a weekly 09:00 in London stays at 09:00 after the clocks change. Importing the file again later fills in the years that have come into the window.
- **Left out**, and counted in the dialog: cancelled events, to-dos, journal entries and alarms.

A calendar's pencil → **Export .ics** writes it as an iCalendar file for other apps: times in UTC, all-day events as dates. Each occurrence of an unrolled repeating event gets a UID of its own (other apps would merge events that share one); `X-CHRONOS-*` properties keep the originals, so importing the file into Chronos again matches the same events.

**Backup** (sidebar) saves every calendar and event, and the settings, as one JSON file, which Chronos restores here or for another user: calendars match by name, events by UID, and restoring the same file twice changes nothing.

## Using it

The sidebar has **New event**, a small month (click a day to go to its month), **Month** and **Agenda**, the **calendars** (click one to show or hide it; the pencil renames, recolours, exports, imports into or deletes it; + makes one), and **Import .ics**, **Settings** and **Backup**.

**Month** shows weeks with their ISO numbers. Clicking an empty part of a day makes an event on it; clicking the day's number, or "+N more", lists everything on it. **Agenda** lists the days with events from today on, 60 days at a time, up to two years ahead; events over several days show on each ("day 2/3").

| Keys   | Action                                    |
| ------ | ----------------------------------------- |
| N      | New event                                 |
| T      | Today's month                             |
| ← →    | Previous and next month                   |
| M, A   | Month, Agenda                             |
| Ctrl+S | Save (in the form)                        |
| Esc    | Close a dialog (asks if the form changed) |

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5178** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter chronos dev` starts only Chronos: the frontend on 127.0.0.1:5178 and the API on 127.0.0.1:3006. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter chronos test    # the server, .ics, time zone and browser tests (Vitest)
```

The database is created at `data/chronos.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Chronos's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                      | Description                                                                                                                      |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me                   | The signed-in user: `{ username, name, accountUrl }`                                                                             |
| GET    | /api/calendars            | The calendars, with how many events each has                                                                                     |
| POST   | /api/calendars            | `{ name, color?, visible? }` → the new calendar (`409 exists` if the name is taken, ignoring case)                               |
| PATCH  | /api/calendars/:id        | `{ name?, color?, visible? }`                                                                                                    |
| DELETE | /api/calendars/:id        | Delete a calendar and its events                                                                                                 |
| GET    | /api/calendars/:id/events | Every event of a calendar (for .ics export)                                                                                      |
| GET    | /api/events?from&to       | The events on the days `from` up to, not including, `to` (`YYYY-MM-DD`, at most 800 days), the days as they are in the home zone |
| POST   | /api/events               | An event's fields → `{ id, rev, updatedAt }`                                                                                     |
| GET    | /api/events/:id           | One event                                                                                                                        |
| PUT    | /api/events/:id           | Its fields and the `rev` it was edited from → `{ id, rev, updatedAt }`; `409 conflict` with the current `event` if `rev` is old  |
| DELETE | /api/events/:id           | Delete an event                                                                                                                  |
| GET    | /api/settings             | `{ homeZone, defaultCalendarId, defaultDuration }`                                                                               |
| PUT    | /api/settings             | The same                                                                                                                         |
| POST   | /api/import               | `{ calendarId \| newCalendar, sourceName, removeMissing, events }` → `{ calendarId, added, updated, unchanged, removed }`        |
| GET    | /api/export               | Every calendar, event and setting as a backup file                                                                               |
| POST   | /api/restore              | A backup file → `{ calendars, added, updated, unchanged }`                                                                       |
| GET    | /healthz                  | `ok` while the service runs (not served through Caddy)                                                                           |

An event's `start` and `end` are instants in UTC (`2026-11-08T17:00:00Z`), or dates when `allDay` is true, the end then being the day after the last (as in iCalendar). Links must be `http://` or `https://` (an address without a scheme gets `https://`). Revisions come from one counter for the whole database. The page sends `X-Chronos-User: <username>` with every request; the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh chronos` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://chronos.<domain>`, or `https://localhost:8448` on WSL. Time zones come from the ICU data in Node.js itself (NodeSource's builds have all of it), so the server needs nothing else.

All users' calendars are in one file, `/var/lib/chronos/chronos.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop chronos
sudo install -m 600 -o "$USER" /var/lib/chronos/chronos.db ~/chronos-backup-$(date +%Y%m%d).db
sudo systemctl start chronos
```

Each user can also save their own calendars (sidebar → Backup).

Calendars belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their calendars, events and settings are deleted the next time Chronos starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them: save a backup before the rename and restore it afterwards.

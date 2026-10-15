# Urd

A time tracker that stays open all day: one big clock, one Play/Stop button, and a few honest numbers. It tells you how much effective work you did, and how often you were interrupted, without your having to remember any start time. Urd has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own time and nobody else's.

There is deliberately no pause, no pomodoro and no break time: a session runs from Play to Stop.

| Layer    | Technology                                                          |
| -------- | ------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                    |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`             |
| Database | `/var/lib/urd/urd.db` on a server, `data/urd.db` in development     |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                     |
| Live     | Server-sent events (`GET /api/events`), as in Althing and Yggdrasil |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
  cutoff.ts          when a session stops by itself, and which day its time counts for
  dates.ts           days as YYYY-MM-DD, weeks from Monday (from Chronos)
  zones.ts           wall clocks in a time zone, and back (from Chronos)
server/
  index.ts           routes, /healthz, removed users' data, the automatic-stop sweep, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  store.ts           the only place sessions and projects are read and written
  events.ts          live updates to every open tab of a user
web/
  timer/             the clock, Play/Stop, the numbers and the estimate
  history/           sessions by day: naming, shortening, deleting
  projects/          projects, their estimates, renaming and merging
  clock.ts           the one-second tick, and live numbers between two answers from the server
  live.ts            the live connection
deploy/
  urd.service        systemd unit (sandboxed)
  urd.caddy          Caddy site: /api to the service (events unbuffered), everything else from dist/web
```

## How it works

**Sessions.** Play starts a session; Stop ends it. Only one runs at a time: pressing Play in a second tab or on another device shows the running one rather than starting another, and every open tab follows within a moment. A session has an optional project and tags, which can be set before, during or after it. One without a project can be named later from History. A project is made when a session is first given its name, and goes by itself once nothing is left in it, neither a session nor an estimate (a typo, corrected).

**Automatic stops.** A session that is never stopped stops by itself at midnight. One started at 22:00 or later may run past midnight, and stops at 05:00 the next morning. Both are decided when Play is pressed, on the clock of the browser that pressed it (its time zone is kept with the session), so changes of summer time are followed. The server needs nothing to happen at that moment: a running session's time is always counted up to now or to its stop, whichever comes first; a sweep every 15 seconds then writes the stop down and tells the open tabs.

**Days, weeks, months.** All of a session's time counts for the day it started, even what came after midnight, and so for that day's week (Monday to Sunday) and month. While a session runs past midnight, "Today" stays its day.

**Interruptions** are play/stop cycles: every session counts as one, the running one and those that stopped by themselves included.

**Corrections only shorten.** A session's start can move later and its end earlier (ending a running session that way stops it then), or it can be deleted. Time can't be added, and no session can be entered by hand: the numbers are what the clock saw.

**Estimates.** A project can have an estimate of its total time. It can be set, lengthened or shortened (±1 hour from the timer, any amount in the project's dialog); every change is kept, so the project shows how the estimate grew.

**The clock** is never counted up in the page: each second it is worked out from when the session started and the time now (corrected if the computer's clock is more than 2 seconds off the server's), so a laptop that slept or a background tab the browser slowed down is right again at once. The tab's title shows the running time, and its icon turns red while a session runs.

## Using it

- **Timer**: the clock, Play/Stop (or **Space**, when no field has the focus), the project and tags (of the running session, or of the next one: by default the last one's), and the numbers: the session, today, this week, this month and overall, each with its time and interruptions, for the project and for all projects. Below, how much of the project's estimate is used up.
- **History**: sessions by day, newest first, with each day's total. "Without a project" lists only those still to be named. A click opens a session to name, shorten or delete it. **CSV** downloads every session (times on the wall clock where each was started) for a spreadsheet.
- **Projects**: every project with its time this week, this month and overall, and its estimate. A click opens it: rename it (a name another project has offers to merge the two, e.g. after a typo), set its estimate, archive it (it leaves the suggestions; its time stays in the totals; using its name again brings it back), or delete it if it has no sessions.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5182** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter urd dev` starts only Urd: the frontend on 127.0.0.1:5182 and the API on 127.0.0.1:3010. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter urd test    # automatic stops, the store, formats and the live clock (Vitest)
```

The database is created at `data/urd.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Urd's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                | Description                                                                                                         |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me             | The signed-in user: `{ username, name, accountUrl }`                                                                |
| GET    | /api/state          | `?today=YYYY-MM-DD&project=<id>?` → `{ now, day, running, last, all, project, unnamed }`: what the timer shows      |
| POST   | /api/sessions/start | `{ zone, project?, tags? }` → the new session, or the one already running                                           |
| POST   | /api/sessions/stop  | → the stopped session; `409 not-running` if none runs                                                               |
| GET    | /api/sessions       | `?before=YYYY-MM-DD&unnamed=1&project=<id>` → `{ sessions, next }`: 14 days of sessions, newest first               |
| PATCH  | /api/sessions/:id   | `{ project?, tags?, startedAt?, endedAt? }`: name it, or shorten it (start later, end earlier) → the session        |
| DELETE | /api/sessions/:id   | Delete a session, a running one too                                                                                 |
| GET    | /api/projects       | `?day=YYYY-MM-DD` → every project with its time around that day and its estimate's history                          |
| PATCH  | /api/projects/:id   | `{ name?, merge?, archived?, estimate? }` → `{ id }`; another project's name is `409 exists` unless `merge` is true |
| DELETE | /api/projects/:id   | Delete a project without sessions (`409 not-empty` otherwise)                                                       |
| GET    | /api/tags           | The tags used, the most used first                                                                                  |
| GET    | /api/export.csv     | Every session as CSV                                                                                                |
| GET    | /api/events         | Server-sent events: `changed` whenever the user's sessions or projects change, and `ping` every 25 s                |
| GET    | /healthz            | `ok` while the service runs (not served through Caddy)                                                              |

Instants are `YYYY-MM-DDTHH:MM:SSZ`, whole seconds; durations are seconds. A project is named, not chosen by id: a name is found ignoring case, or makes a new project. The page sends `X-Urd-User: <username>` with every request (the event stream: `?user=`); the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh urd` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://urd.<domain>`, or `https://localhost:8452` on WSL.

All users' sessions are in one file, `/var/lib/urd/urd.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop urd
sudo install -m 600 -o "$USER" /var/lib/urd/urd.db ~/urd-backup-$(date +%Y%m%d).db
sudo systemctl start urd
```

Each user can also download their sessions as CSV (History → CSV).

Sessions belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their sessions and projects are deleted the next time Urd starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them.

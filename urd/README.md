# Urd

A time tracker that stays open all day: one big clock, one Play/Stop button, and a few honest numbers. It tells you how much effective work you did, and how often you were interrupted, without your having to remember any start time. Urd has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own time and nobody else's.

There is deliberately no pause, no pomodoro and no break time: a session runs from Play to Stop, and only you stop it.

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
  days.ts            which days a session's time counts for: split at each midnight
  dates.ts           days as YYYY-MM-DD, weeks from Monday (from Chronos)
  zones.ts           wall clocks in a time zone, and back (from Chronos)
server/
  index.ts           routes, /healthz, removed users' data, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  store.ts           the only place sessions, tasks and projects are read and written
  events.ts          live updates to every open tab of a user
web/
  timer/             the clock, Play/Stop, Resume, the numbers and the estimate
  history/           sessions by day: naming, shortening, deleting
  projects/          projects and their tasks, estimates, renaming and merging
  clock.ts           the one-second tick, and live numbers between two answers from the server
  tasks.ts           finding a task by name, and the tags it resumes with
  live.ts            the live connection
  theme.ts           light or dark: the computer's setting, or the header's switch
deploy/
  urd.service        systemd unit (sandboxed)
  urd.caddy          Caddy site: /api to the service (events unbuffered), everything else from dist/web
```

## How it works

**Sessions.** Play starts a session; Stop ends it. Nothing else does: a session left running runs on, for days if need be, until it is stopped (or shortened, see below). Only one runs at a time: pressing Play in a second tab or on another device shows the running one rather than starting another, and every open tab follows within a moment. ▶ on a task in Resume is the exception: it stops the running session and starts that one in the same moment.

**Projects and tasks.** A session has an optional project, an optional task and tags, which can be set before, during or after it. A task is a name, inside a project or on its own: the sessions with the same project and task name (ignoring case) are that task, spelled as it was first. Tasks have no estimate, only their time and interruptions. A session with neither project nor task is _unnamed_, and can be named later from History. A project is made when a session is first given its name, and goes by itself once nothing is left in it, neither a session nor an estimate (a typo, corrected).

**Resuming.** Resume lists the latest tasks (and projects used without a task); ▶ starts one again with the tags its latest session had. Choosing a project or a task in the timer's fields also brings its last tags: the task's, else the project's latest; a name never used keeps the tags shown. On a running session without tags, naming it brings them too. New task empties the fields for a task not in the list, stopping a running session first.

**Days, weeks, months.** A session's time counts for the days it covers, split at each midnight on the clock of the browser that pressed Play (its time zone is kept with the session, so changes of summer time are followed): 22:30 to 01:15 is 1h 30m for one day and 1h 15m for the next, and so for their weeks (Monday to Sunday) and months. "Today" is always today: after midnight, a running session's numbers move on to the new day.

**Interruptions** are play/stop cycles: every session counts as one, the running one included, in each period it has time in (a session past midnight counts on both days).

**Longest** is the longest uninterrupted work in a period: the longest session, by its part in that period, so it is never more than the period's time.

Sessions from before Urd 2.0.0 that stopped by themselves at midnight or 05:00 keep that stop, and are marked "stopped by itself".

**Corrections only shorten.** A session's start can move later and its end earlier (ending a running session that way stops it then), or it can be deleted. Time can't be added, and no session can be entered by hand: the numbers are what the clock saw.

**Estimates.** A project can have an estimate of its total time. It can be set, lengthened or shortened (±1 hour from the timer, any amount in the project's dialog); every change is kept, so the project shows how the estimate grew.

**The clock** is never counted up in the page: each second it is worked out from when the session started and the time now (corrected if the computer's clock is more than 2 seconds off the server's), so a laptop that slept or a background tab the browser slowed down is right again at once. The tab's title shows the running time, and its icon turns red while a session runs.

## Using it

- **Timer**: the clock, Play/Stop (or **Space**, when no field has the focus), Resume, the project, task and tags (of the running session, or of the next one: by default the last one's), how much of the project's estimate is used up, and the numbers: the session, today, this week, this month and overall, each with its time, interruptions and longest, for the task, the project or all (a switch; the choice is kept on the computer).
- **History**: sessions by day, newest first, with each day's total; a session past midnight is on each of its days, with that day's part. "Unnamed" lists only those still to be named. A click opens a session to name, shorten or delete it. **CSV** downloads every session (times on the wall clock where each was started) for a spreadsheet.
- **Projects**: every project with its time this week, this month and overall, its estimate and its tasks (its sessions without a task first, then the tasks in the order they were started, each with its time and interruptions); then the tasks without a project. A click on a project opens it: rename it (a name another project has offers to merge the two, e.g. after a typo), set its estimate, archive it (it leaves the suggestions; its time stays in the totals; using its name again brings it back), or delete it if it has no sessions. A click on a task renames it or moves it to another project, all its sessions with it; a name the project has already puts the two tasks together.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5182** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter urd dev` starts only Urd: the frontend on 127.0.0.1:5182 and the API on 127.0.0.1:3010. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter urd test    # days past midnight, the store, tasks, formats and the live clock (Vitest)
```

The database is created at `data/urd.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Urd's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                | Description                                                                                                                       |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me             | The signed-in user: `{ username, name, accountUrl }`                                                                              |
| GET    | /api/state          | `?today=YYYY-MM-DD&project=<id>?&task=<name>?` → `{ now, day, running, last, all, project, task, unnamed }`: what the timer shows |
| POST   | /api/sessions/start | `{ zone, project?, task?, tags?, switch? }` → the new session, or the one already running (unless `switch`: it stops)             |
| POST   | /api/sessions/stop  | → the stopped session; `409 not-running` if none runs                                                                             |
| GET    | /api/sessions       | `?before=YYYY-MM-DD&unnamed=1&project=<id>` → `{ days, sessions, next }`: 14 days of sessions, newest first                       |
| PATCH  | /api/sessions/:id   | `{ project?, task?, tags?, startedAt?, endedAt? }`: name it, or shorten it (start later, end earlier) → the session               |
| DELETE | /api/sessions/:id   | Delete a session, a running one too                                                                                               |
| GET    | /api/projects       | `?day=YYYY-MM-DD` → every project with its time around that day and its estimate's history                                        |
| PATCH  | /api/projects/:id   | `{ name?, merge?, archived?, estimate? }` → `{ id }`; another project's name is `409 exists` unless `merge` is true               |
| DELETE | /api/projects/:id   | Delete a project without sessions (`409 not-empty` otherwise)                                                                     |
| GET    | /api/tasks          | `?day=YYYY-MM-DD` → every task (and each project's sessions without one), the latest used first, with its time and last tags      |
| PATCH  | /api/tasks          | `{ projectId, name, rename?, project? }`: rename a task or move it to another project → `{ projectId, name }`                     |
| GET    | /api/tags           | The tags used, the most used first                                                                                                |
| GET    | /api/export.csv     | Every session as CSV                                                                                                              |
| GET    | /api/events         | Server-sent events: `changed` whenever the user's sessions or projects change, and `ping` every 25 s                              |
| GET    | /healthz            | `ok` while the service runs (not served through Caddy)                                                                            |

Instants are `YYYY-MM-DDTHH:MM:SSZ`, whole seconds; durations are seconds. A project is named, not chosen by id: a name is found ignoring case, or makes a new project. So is a task, within its project. The page sends `X-Urd-User: <username>` with every request (the event stream: `?user=`); the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh urd` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://urd.<domain>`, or `https://localhost:8452` on WSL.

All users' sessions are in one file, `/var/lib/urd/urd.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop urd
sudo install -m 600 -o "$USER" /var/lib/urd/urd.db ~/urd-backup-$(date +%Y%m%d).db
sudo systemctl start urd
```

Each user can also download their sessions as CSV (History → CSV).

Sessions belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their sessions (and so their tasks) and projects are deleted the next time Urd starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them.

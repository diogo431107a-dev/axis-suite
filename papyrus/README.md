# Papyrus

A journal: one page for every day, in as many journals as you like (a personal diary, a work log, dreams…), each with an optional mood and `#tags` in the text. Papyrus has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own journals and nobody else's.

| Layer    | Technology                                                                  |
| -------- | --------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                            |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                     |
| Database | `/var/lib/papyrus/papyrus.db` on a server, `data/papyrus.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                             |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
  dates.ts           days as YYYY-MM-DD, and their arithmetic
  tags.ts            the #tags in a text
  words.ts           word counts, and text without case or accents (for search)
  query.ts           the search language
server/
  index.ts           routes, /healthz, removed users' journals, recycle-bin purge, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  store.ts           the only place journals are read and written
web/
  pages/sync.ts      saving pages as they are typed (and keeping them in the browser until saved)
  day/               a day's page: mood, text, prompts and templates, On this day
  calendar/          the sidebar's month, the month calendar, the year in moods
  search/            search results
  dialogs/           journals, templates, settings, export and import
  prompts/           the built-in writing prompts
  io/markdown.ts     the Markdown export
deploy/
  papyrus.service    systemd unit (sandboxed)
  papyrus.caddy      Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Pages.** Each journal has at most one page per day: its text (plain text, as typed), a mood from 1 (Awful) to 5 (Great), or both. A page that is emptied (no text and no mood) is deleted. "Today" is the day in the browser's time zone; the server never decides which day it is.

**Saving.** There is no Save button. A page is saved a second after typing stops (at least every 10 seconds while it goes on), at once when the mood changes, and when you leave the page, the day or the tab. Until the server has it, the text is also kept in the browser (`localStorage`), so a lost connection, a closed tab or an ended session loses nothing: the next visit, from the same browser, sends it. While Papyrus can't be reached, a line says so, and it tries again (after 1 s, then up to every 30 s). Leaving the page with something unsaved asks first.

**Two places at once.** Every save names the version of the page it was written on. If the page was saved elsewhere since (another tab, another device), Papyrus stops saving it and asks what to keep: your text, the other version, or both (the other first). Tabs in the same browser tell each other about saves, so a page open in two tabs shows the newest text when you aren't typing in it.

**Tags** are words after a `#`, with letters, digits and `_`, and `-` or `/` between them: `#travel`, `#família`, `#well-being`, `#work/meetings` (a tag under `#work`). Web addresses, `C#`, `issue#4` and `#2026` (no letter) aren't tags. They are found when a page is saved, listed under it and in the sidebar, and a click searches for them.

**Deleting.** A journal goes to the recycle bin with all its pages, and is deleted for good 30 days later (checked at start-up and daily), or when it is deleted from the bin. Its pages don't show anywhere meanwhile.

**Signing out.** If the session ends while someone is writing, a banner asks them to sign in again in a new tab; the text waits in the browser and is saved when they come back. If a different user signs in (in another tab), the page starts over with that user's journals: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in. Unsaved text is kept per user, so it never reaches another account.

## Using it

**A day.** The sidebar's calendar, the arrows and the calendar button move between days; the dot under a day is its mood's colour (grey: written, no mood). An empty page offers a writing prompt (the same one all day; "Another" shows the next) and your templates, the journal's own one first. Nothing is filled in by itself. Under the page, **On this day** shows the pages of the same day in earlier years, in every journal (on 28 February of a year without a 29th, the 29ths too).

**Calendar** shows a month of pages with the start of each, **Year in moods** a square for every day of a year in the colour of its mood, both for one journal or all of them (a day's mood is then the average). The sidebar also counts the days in a row with a page in any journal, up to today or yesterday.

**Search** (the box at the top of the sidebar) finds pages by everything typed, newest first:

| Example                         | Finds pages…                                               |
| ------------------------------- | ---------------------------------------------------------- |
| `rain walk`                     | with both words, in any case, with or without accents      |
| `"long walk"`                   | with the words together                                    |
| `-work`                         | without the word                                           |
| `#travel`                       | with the tag, or one under it (`#travel/japan`)            |
| `mood:5`, `mood:>=4`, `mood:<3` | by mood                                                    |
| `before:2026-01-01`             | before that day (`after:` too; the day itself not counted) |

Words match inside longer words (`walk` finds "walking"). At most 200 results are shown.

**Templates** (sidebar) are texts an empty page can start from, such as a gratitude list or an evening review. A journal can offer one first (its pencil in the sidebar). **Settings** take your own writing prompts, one per line, in place of the built-in ones, and the first day of the week.

| Keys   | Action                                  |
| ------ | --------------------------------------- |
| ← / →  | Previous / next day (outside the text)  |
| T      | Today                                   |
| /      | Search                                  |
| Esc    | Leave the text (so the keys above work) |
| Ctrl+S | Save now                                |

**Export and import** (sidebar). The JSON backup holds every journal (not the recycle bin), its pages, your templates and settings, and can be imported again, here or by another user. An import adds to what is there: journals with the same name are filled, a page already there (or already contained in the day's page) is skipped, a page that contains the day's page replaces it, and anything else is added after it. Importing the same file twice changes nothing. The Markdown export is for reading and printing: one heading per journal and per day, with the mood.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5176** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter papyrus dev` starts only Papyrus: the frontend on 127.0.0.1:5176 and the API on 127.0.0.1:3004. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter papyrus test    # the server and browser tests (Vitest)
```

The database is created at `data/papyrus.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Papyrus's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`. Days are `YYYY-MM-DD`.

| Method | Path                           | Description                                                                                                       |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me                        | The signed-in user: `{ username, name, accountUrl }`                                                              |
| GET    | /api/journals                  | Every journal, with its number of pages (recycle bin included: `deletedAt` set)                                   |
| POST   | /api/journals                  | `{ name, color? }` → the new journal (`409 exists` if the name is taken, ignoring case)                           |
| PATCH  | /api/journals/:id              | `{ name?, color?, templateId? }`                                                                                  |
| PUT    | /api/journals/order            | Every journal id, in the order the sidebar shows them                                                             |
| DELETE | /api/journals/:id              | Move to the recycle bin; with `?purge=1`, delete from the bin for good                                            |
| POST   | /api/journals/:id/restore      | Take out of the recycle bin                                                                                       |
| GET    | /api/pages/:journalId/:date    | The page: `{ text, mood, tags, words, rev, updatedAt }`; a day without one has `rev` 0 and empty text             |
| PUT    | /api/pages/:journalId/:date    | `{ text, mood, rev }` → `{ rev, words, tags, updatedAt }`; `409 conflict` with the current `page` if `rev` is old |
| GET    | /api/days?from&to&journal?     | The pages of up to 400 days, without their text: `{ journalId, date, mood, words, tags, preview }`                |
| GET    | /api/on-this-day?date&journal? | The pages of the same day in earlier years, newest first                                                          |
| GET    | /api/streak?today&journal?     | `{ days }`: days in a row with a page, ending today or yesterday                                                  |
| GET    | /api/tags                      | `[{ tag, count }]`                                                                                                |
| GET    | /api/search?q&journal?         | `{ hits: [{ journalId, date, mood, snippet, marks }], more }`, newest first                                       |
| GET    | /api/templates                 | The templates                                                                                                     |
| POST   | /api/templates                 | `{ name, text }` → the new template                                                                               |
| PATCH  | /api/templates/:id             | `{ name?, text? }`                                                                                                |
| DELETE | /api/templates/:id             | Delete a template (journals that offered it first no longer do)                                                   |
| GET    | /api/settings                  | `{ prompts, weekStart }` (`null`: the built-in prompts; the browser's custom)                                     |
| PUT    | /api/settings                  | The same                                                                                                          |
| GET    | /api/export                    | Every journal, template and setting as an export file                                                             |
| POST   | /api/import                    | An export file → `{ journals, templates, pages, merged, skipped }`                                                |
| GET    | /healthz                       | `ok` while the service runs (not served through Caddy)                                                            |

`rev` in a `PUT` is the revision the page was written on, `0` for a day without a page. Revisions come from one counter for the whole database, so a page that was emptied (deleted) and written again never has an old one. A `PUT` of exactly what is stored always succeeds, so a save whose answer got lost can simply be sent again. The page sends `X-Papyrus-User: <username>` with every request; the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh papyrus` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://papyrus.<domain>`, or `https://localhost:8446` on WSL.

All users' journals are in one file, `/var/lib/papyrus/papyrus.db` (one file: no write-ahead log). It is not encrypted: it holds everyone's diaries in plain text, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop papyrus
sudo install -m 600 -o "$USER" /var/lib/papyrus/papyrus.db ~/papyrus-backup-$(date +%Y%m%d).db
sudo systemctl start papyrus
```

Each user can also export their own journals (sidebar → Export and import).

Journals belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their journals, templates and settings (recycle bin included) are deleted the next time Papyrus starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them: export the journals before the rename and import them afterwards.

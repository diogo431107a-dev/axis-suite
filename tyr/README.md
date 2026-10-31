# Tyr

A dossier of people: what they said, when and where, and how you came to know it. It builds a subjective profile, not an objective record: what matters to someone, what they fear, how they treat others. Tyr is named for the god of oaths and the Thing, and aims for the same tone: faithful, fair, never vindictive. It has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own drawer and nobody else's.

| Layer    | Technology                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, plain CSS                                                    |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                        |
| Database | `/var/lib/tyr/tyr.db` on a server, `data/tyr.db` in development                |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                |
| Address  | `https://tyr.<domain>`; https://localhost:8456 in WSL; port 5186 in `pnpm dev` |

```
shared/
  protocol.ts        API types, vocabulary and limits: the wire format, used by the server and the page
  time.ts            moments and names: folding, the drawer's letter, sorting and checking dates
server/
  index.ts           routes, /healthz, removed users' drawers, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  check.ts           checking what comes in
  dossier.ts         the rules of the record: files, entries, the profile, places
  trust.ts           care notes, word given, concerns, corrections, what was said about me
  incidents.ts       incidents and the hearsay kept in them
  seed.ts            example people for a development drawer; never built
web/
  App.tsx            signing in, loading, and what is on screen
  page.ts            what every part of the page shares
  model.ts           what is worked out from a drawer: status, threads, basis, gaps
  time.ts            reading and showing dates
  vocab.ts           the words for sources and questions
  Drawer.tsx         the A to Z drawer
  file/              an open file: Handle with care, Profile, Timeline, Incidents, Word given, the briefing
  views/             Threads, Places, Search
  forms/             an entry, Muninn and Just met, a profile answer, a file's details, the date and hour
  ui/                the sliding sheet, the source marks, choosing entries, the About box
deploy/
  tyr.service        systemd unit (sandboxed)
  tyr.caddy          Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Entries** are the atom of the app: one idea, in a sentence or two. Each has three clocks. _Happened at_ is when the event took place, and _told at_ is when they told me or I saw it; both can be vague (a month, a year, "around 2009"), because false precision is worse. _Logged at_ is when it was typed: the server sets it, and the database refuses to change it. Dates are always ISO and times 24h, and are kept as typed, never converted. Only logged-at is an instant, shown in the browser's own time.

**Their words first.** Every entry says where it came from, shown by a mark whose shape carries the meaning:

| Source     | What it means                                        | In the profile           |
| ---------- | ---------------------------------------------------- | ------------------------ |
| Unprompted | They brought it up themselves                        | Yes: the backbone        |
| Invited    | I asked something open, and they chose what to share | Yes, marked invited      |
| Prompted   | I asked for this                                     | No: a separate ledger    |
| Observed   | I saw it                                             | Yes, and outweighs words |
| Inferred   | My conclusion                                        | Yes, labelled my reading |

Saving a Prompted entry warns once, and never blocks. Whose voice, on each file, shows the balance.

**Append, don't overwrite.** A finished entry's words can't be changed: a correction is a new entry that amends the old one, and both stay visible. Filing is not rewriting, so at any time an entry can be filed under another question, marked to their credit or linked to an incident, and a follow-up marked done. A quick capture is incomplete until it has a place and a category; until then it can be completed, or discarded if it was a mistake.

**The profile** has sixteen questions, nine from the original idea and seven added. An answer is written by hand in my own words and points to the entries it rests on, which give it its basis: their words, observed, or my reading. Prompted entries are left out, and it says how many. Each revision is a new version, and earlier ones stay readable. A question with nothing behind it shows as not yet known: gaps are for listening, not for asking. An answer not revised for six months asks to be checked.

**Contradictions** are two entries side by side with their dates, with no verdict, because many are just a person changing. If one of them was observed, it says that behaviour outweighs words.

**Handle with care** comes first on a file, visible without scrolling: what to do, not the story behind it. Each note has a level (never raise, be careful, only if they do, practical, watching, welcome), and can be reworded, confirmed as still true, or retired, which keeps it readable under the box. A care note can carry a day of the year that is hard for them; it shows in Open threads from 30 days before until 6 days after. These are my own instructions rather than a record of what was said, so unlike entries they can change.

**Word given** goes both ways, and tracking my own promises matters as much as tracking theirs. A due date is optional, and an undated word is never overdue. An outcome (kept, broken, released) is final, but a mistaken click can be undone on the same day.

**Concerns** are how a worry is kept from becoming a grudge. A concern has a review date after the day it is opened, and nothing can be decided before then, on the page or on the server. The review needs a note. A breach also needs evidence beyond my own conclusions, so at least one entry that isn't Inferred: a suspicion can't prove itself. While a concern is open the card also shows the latest entries marked to their credit. A review is final; if it was wrong, that goes in **Where I read them wrong**, a record of my own errors.

**Said about me** tracks what I am told someone said about me to others. It is hearsay: it goes in the file of whoever reportedly said it, with who told me, and it is marked not to reveal the source. It stays out of the profile, the timeline and Whose voice, can't be changed (the database refuses), and shows beside an open concern labelled as not evidence, so a report alone never proves a breach. If I hear it said myself, that is an Observed entry.

**Incidents** are things bigger than one entry: a fight, an arrest, a move. What I saw or was told stays an ordinary entry that points to the incident, with its own source and clocks. The only thing written into an incident is hearsay, which can't be changed either. An incident can involve several files, and mentions people with no file, who can get one later. What is known (rumour, told by one party, confirmed, disproved) can change, and the history stays. An incident can be closed with a note and reopened. Destroying the last file in one removes it.

**Before I see them** is one page for a file: handle with care, last contact, open threads, the last things they told me unprompted, what makes them happy, anything they asked me not to repeat, and anything said about me.

**Muninn** is the quick capture, for after a conversation: who, the source, one line. `@name` says who else was there, `#fear` or `#joy` files it, and `!care` also files a Be careful note in the same words. Just met opens a file and its first entry in one step. Threads lists what is left open: words given, follow-ups, concerns up for review, gentle weeks, open incidents, incomplete entries, what was said on this day in earlier years, and dormant files. It all stays in Tyr: nothing is sent to other apps.

**The drawer** is alphabetical by first name, since surnames are rarely known, with accents folded and anything else under `#`. Two files can't answer to the same name or nickname. A file is dormant after six months without contact, which is worked out from the dates and stored nowhere. Closing a file takes it out of the drawer and keeps it. Destroying one asks for its name, removes everything in it and can't be undone; its number is never used again.

**Places** are labels, never addresses, and one place is spelled one way: "cafeteria" finds "Cafeteria". Renaming changes it everywhere. A place is removed only if nothing was logged there.

**Saving.** Each change is saved on the server before its form closes: the form says "saved" by closing, or says why not and keeps what was typed. An id is made by the browser, so sending something twice saves it once. A form that has been typed in closes only by its own buttons. The page catches up with changes made elsewhere when the window gets the focus back.

**Signing out.** If the session ends, a notice asks to sign in again in a new tab, and an open form keeps what was typed. If a different user signs in (in another tab), the page starts over as that user: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

**Narrow windows.** Below 820px the page shows the drawer or the open file, not both, instead of the suite's usual slide-in sidebar, because the drawer is the app.

## Decisions

Settled while the idea was being worked out, so they aren't reopened by accident:

- **Tyr stands alone,** like [every module](../README.md#modules-are-independent). No shared person ID with Every Man is a Star, and nothing sent to or taken from Chronos, Loggbok or Yggdrasil. How people relate to each other belongs in Star; a fight or an arrest is told here. Whether the two agree is up to the user.
- **No encryption,** of the database or its backups. Heimdall guards access, and encrypting would complicate backups and risk losing data. Backups are the owner's job, as with other modules.
- **Hearsay is not a source.** It isn't reliable, so it is never an entry. It is kept in only two places, always flagged: inside an incident, and as something said about me.
- **"Asked me not to repeat"** records what they asked, nothing more. Keeping it is up to whoever holds the information.
- **There is no legacy rule** for what happens to the data afterwards.
- **Who gets a file:** mostly colleagues and acquaintances, sometimes friends and family. Students don't get one; the form says so and nothing enforces it.
- **What Tyr is not:** a contact book, a health record, surveillance, a CRM, or a journal about me. Written by hand, with nothing imported and no external calls.

## Not yet

Phases 1 to 3 are done: the UI pilot, saving for real, and care and trust. Still to come:

4. **Hardening:** an open file returning to the drawer when left alone, blur when the window loses focus, plain-text export of a file.

Later: group briefings, patterns over time, a map that needs no addresses, local voice dictation.

## Installing and data

```bash
sudo bash deploy/install.sh tyr
```

With a real domain, `tyr.<domain>` needs a DNS record first, unless a wildcard covers it.

The database is `/var/lib/tyr/tyr.db`, readable only by the service, and an install upgrades it by itself. Back it up as in the [suite README](../README.md#operating-it), and regularly: **removing or renaming a user in Heimdall deletes their drawer on the next deploy**, as it does with every module's data.

In development, `pnpm --filter tyr seed` fills the drawer of `odin` (or the username given) with the UI pilot's made-up people. It only touches `data/tyr.db`, refuses a drawer that already has files, and isn't part of what gets installed.

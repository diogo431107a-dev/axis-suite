# Althing

The suite's real-time chat: a lobby that is always there, rooms anyone can open, and direct messages between two people. Everyone goes by a nickname and a fun picture, and personal information is forbidden. Althing has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md).

Everything said in Althing is **on record**: nobody can edit or delete a message, closed rooms stay in the database, and so does who was in a room when and every nickname anyone has had. The owner reads the record on the server (see [Reading the record](#reading-the-record)); there is no admin screen.

| Layer    | Technology                                                                  |
| -------- | --------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                            |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`, server-sent events |
| Database | `/var/lib/althing/althing.db` on a server, `data/althing.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`, plus Heimdall's `/online`  |

```
shared/
  protocol.ts        API types, limits and live events: used by the server and the page
  avatars.ts         the profile pictures to choose from (files in public/avatars/)
server/
  index.ts           routes, /healthz, removed users, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version); triggers keep the record
  store.ts           the only place the database is read and written
  events.ts          the live connections (GET /api/events), one or more per person
  presence.ts        who is in which room, and closing empty rooms, with a grace period
  online.ts          who is online: asks Heimdall every 15 seconds
web/
  App.tsx            the page: state, live updates, which conversation is open
  Sidebar.tsx        lobby, rooms, direct messages, people
  Conversation.tsx   the messages and the box to write in
  live.ts            the live connection, reconnecting by itself
  dialogs/           profile (with the rules), someone's profile card, rooms
public/avatars/      the pictures
deploy/
  althing.service    systemd unit (sandboxed)
  althing.caddy      Caddy site: /api/events unbuffered, /api to the service, the rest from dist/web
```

## How it works

**Profiles.** Every Heimdall user has one, made the first time Althing hears of them: their username as nickname and a picture picked at random from twelve. The first visit opens the profile with a welcome and the rules. A profile has a picture (from the set), a nickname (2 to 24 characters, unique, ignoring case) and "About me" (up to 500 characters). The profile says, in a box that can't be missed, that personal information is forbidden and that everything is kept on record. Nothing enforces the rule; it is the users' responsibility. Clicking someone's picture or name opens their profile card, with a button to write to them.

**Online** means having a live Heimdall session, wherever in the suite: someone who signed in yesterday and closed everything still shows online until the session ends (48 hours unused, or 14 days after signing in). Althing asks Heimdall's `GET /online` every 15 seconds while anyone has Althing open, with the cookie of one of them (the question doesn't keep anyone's session alive), and pushes changes to every page. Someone who still has Althing open but no session any more has signed out: their pages stop receiving messages and say so. With an older Heimdall that has no `/online`, "online" falls back to having Althing open.

**The lobby** is always open and everyone is in it.

**Rooms** work like IRC. Anyone sees the open rooms and can join one; opening a room puts its creator in it. A person is in a room until they click Leave, or until a minute after they closed their last Althing tab (the minute covers reloads, a dropped connection and server restarts). A room nobody has been in for a minute closes: it disappears from the app, but stays in the database with its messages. A new room may then take the same name; it is a different room, with a new number and no history. Only the people in a room read and write in it. Up to 100 rooms are open at once; names have up to 40 characters and are unique among open rooms.

**Direct messages** are between two people, one conversation per pair, started from someone's profile card.

**Messages** are plain text, up to 2,000 characters; links become clickable. Enter sends, Shift+Enter starts a new line. They can't be edited or deleted, by anyone: the database itself refuses it. Ten messages per ten seconds per person at most. Times show as `HH:MM` with a `YYYY-MM-DD` line where the day changes, in the device's time zone; the database keeps UTC.

**Unread counts** (for the lobby, your rooms and your direct messages, and in the tab's title) are only yours. Nobody sees whether you have read anything: there are no read receipts.

**Live updates** come over one server-sent events stream per tab. The browser reconnects by itself; a stream that stays silent for over a minute (the server pings every 25 seconds) is replaced, and after any break the page fetches what it missed.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5180** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter althing dev` starts only Althing: the frontend on 127.0.0.1:5180 and the API on 127.0.0.1:3008. It still needs Heimdall on 127.0.0.1:3000. `dev.env` lists the demo users, so everyone has a profile from the start; keep it in step with `heimdall/server/users.ts`.

```bash
pnpm --filter althing test    # the store, rooms, live connections, who is online, links (Vitest)
```

The database is created at `data/althing.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Althing's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`. A conversation is named by a key: `r<id>` for the lobby (`r1`) or a room, `d<id>` for a direct conversation.

| Method | Path                 | Description                                                                                     |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | /api/me              | The signed-in user: `{ username, name, accountUrl }`                                            |
| GET    | /api/state           | Everything the page starts with: profile, people, who is online, rooms, direct messages, unread |
| PUT    | /api/profile         | `{ nickname, about, avatar }` → the profile (`409` if the nickname is taken)                    |
| POST   | /api/welcomed        | The welcome was seen                                                                            |
| POST   | /api/rooms           | `{ name }` → `{ id }`: a new room, with its creator in it                                       |
| POST   | /api/rooms/:id/join  | Join a room                                                                                     |
| POST   | /api/rooms/:id/leave | Leave a room                                                                                    |
| POST   | /api/dms             | `{ with: username }` → the direct conversation with them, started if new                        |
| GET    | /api/messages/:key   | The latest 50 messages, oldest first; `?before=<id>` for the 50 before that                     |
| POST   | /api/messages/:key   | `{ body }` → the message (`403` in a room you aren't in; `429 too-fast` over the limit)         |
| POST   | /api/read            | `{ conv, id }`: you have seen that conversation up to message `id`                              |
| GET    | /api/events          | Live updates: `message`, `rooms`, `online`, `person`, and a `ping` every 25 seconds             |
| GET    | /healthz             | `ok` while the service runs (not served through Caddy)                                          |

The page sends `X-Althing-User: <username>` with every request (`?user=` on the event stream); the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh althing` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://althing.<domain>`, or `https://localhost:8450` on WSL. Heimdall must be a version with `GET /online` (from Althing's first version on); reinstall Heimdall first if it is older.

Everything is in one file, `/var/lib/althing/althing.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop althing
sudo install -m 600 -o "$USER" /var/lib/althing/althing.db ~/althing-backup-$(date +%Y%m%d).db
sudo systemctl start althing
```

There is no per-user backup or export: the conversations belong to everyone in them.

**Removed users.** Messages belong to the conversation, not to the person who wrote them. When a user is removed from Heimdall's `users.ts`, the next time Althing starts it deletes their profile, nickname history and unread counts, and takes their username off every row (it becomes empty, `NULL`). Everything they said stays, shown as _deleted user_; a direct conversation with them can still be read but not answered. This is Althing's exception to the suite's rule that a removed user leaves nothing behind. Renaming a user counts as removing them: their old messages become a deleted user's.

## Reading the record

The record is read with `sqlite3` on the server, as root (the database is private to the service). `-readonly` makes sure nothing is changed; reading while Althing runs is safe. Times are UTC. A username that is empty was a removed user.

```bash
sudo sqlite3 -readonly -box /var/lib/althing/althing.db
```

Then, at the `sqlite>` prompt (change the numbers and names in quotes):

```sql
-- Rooms, newest first: who opened each, when, and when it closed (empty: still open)
SELECT id, name, created_by, created_at, closed_at FROM rooms ORDER BY id DESC LIMIT 50;

-- Rooms whose name contains "games"
SELECT id, name, created_by, created_at, closed_at FROM rooms WHERE name LIKE '%games%';

-- Everything said in room 7, with each author's nickname at the time
SELECT m.created_at, m.author,
       (SELECT n.nickname FROM nicknames n WHERE n.username = m.author AND n.from_at <= m.created_at
        ORDER BY n.from_at DESC LIMIT 1) AS nickname,
       m.body
FROM messages m WHERE m.room_id = 7 ORDER BY m.id;

-- Who was in room 7, and when (left_at empty: still there)
SELECT username, joined_at, left_at FROM room_visits WHERE room_id = 7 ORDER BY joined_at;

-- Who has gone by the nickname "Bob", and since when
SELECT username, nickname, from_at FROM nicknames WHERE nickname LIKE 'Bob' ORDER BY from_at;

-- Every nickname of one user
SELECT nickname, from_at FROM nicknames WHERE username = 'john' ORDER BY from_at;

-- Everything one user has written, everywhere
SELECT created_at, CASE WHEN room_id IS NOT NULL THEN 'room ' || room_id ELSE 'direct ' || dm_id END AS place, body
FROM messages WHERE author = 'john' ORDER BY id;

-- The direct conversation between two users (the two usernames in alphabetical order)
SELECT m.created_at, m.author, m.body
FROM messages m JOIN dms d ON d.id = m.dm_id
WHERE d.user_a = 'freya' AND d.user_b = 'odin' ORDER BY m.id;
```

`.quit` leaves. To keep a copy of what a query shows, run it from the shell with `-csv` and save the output, e.g. `sudo sqlite3 -readonly -csv /var/lib/althing/althing.db "SELECT …" > ~/room-7.csv`.

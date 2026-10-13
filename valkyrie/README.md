# Valkyrie

A kanban. Each user has any number of boards (Work, Home, Garden…); a board has lists side by side, and the lists hold cards that move along as the work goes, with the mouse, a finger or the keyboard. Valkyrie has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own boards and nobody else's.

| Layer    | Technology                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                               |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                        |
| Database | `/var/lib/valkyrie/valkyrie.db` on a server, `data/valkyrie.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
  dates.ts           days as YYYY-MM-DD (due dates), months and ISO weeks for the date picker
server/
  index.ts           routes, /healthz, removed users' boards, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  ranks.ts           where things sit in a list: fractional indexes
  store.ts           the only place boards, lists, cards and checklists are read and written
web/
  board/
    model.ts         the board in the page, and every move, as pure functions
    saver.ts         sends moves to the server one at a time, merging repeated ones
    keys.ts          what each key means
    dnd.ts           drag and drop with pointer events (mouse, pen, finger)
    BoardView.tsx    the board: lists, cards, keys, drags
  card/              the card dialog and its checklist
  dialogs/           board, labels, backup, keyboard help, "are you sure"
  inputs/            the due date field (YYYY-MM-DD) and its small month
deploy/
  valkyrie.service   systemd unit (sandboxed)
  valkyrie.caddy     Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Boards** have a name (unique, ignoring case) and a colour. A new board starts with the lists To do, Doing and Done and six coloured labels, or empty. Boards are ordered in the sidebar by dragging them, or with Ctrl+Shift+↑/↓ on one. Up to 100 boards, 50 lists and 5,000 cards on a board, 50,000 cards in all.

**Cards** have a title, labels, a due date, a description and a checklist. On the board a card shows its labels (a colour bar, or a chip with the name), its title, and badges: the due date (red when it has passed, amber on the day), the checklist (`3/5`, green when done) and a mark when it has a description. Clicking a card opens it; each change there is saved at once.

- **Labels** belong to a board (Labels, above the board): a colour, with a name if wanted. Deleting one takes it off its cards.
- **Due dates** are dates only, written `YYYY-MM-DD`, with no time or time zone. "Today" is the device's date.
- **The checklist** is one list of items to tick. Drag an item by its grip, or press Ctrl+Shift+↑/↓ in it, to reorder.

**Moving cards.** A move shows at once and is saved behind it. Moves are saved one at a time, in order; a card moved again before its turn is saved once, where it ended up. Each move tells the server which card it now follows (never a position number), and the server keeps the order as fractional indexes, so a move changes one row. If a save fails, the board is reloaded from the server and a notice says so. The board also reloads when the window gets the focus back, so changes from another tab show up.

**Moving to another board** is in the card's dialog (_Move…_, which also picks a list and a position, and is the easy way on a phone). Labels go to the other board's label with the same name and colour; those it doesn't have are left off, and the notice says how many.

**Deleting** a card, a list with cards, or a board asks first, saying how much goes with it. Nothing can be brought back afterwards except from a backup.

**Saving card changes.** Every change names the version of the card it was made to. If the card was changed elsewhere since (another tab, another device), the dialog shows it as it is now and says so; the change has to be made again.

**Signing out.** If the session ends, a banner asks to sign in again in a new tab. If a different user signs in (in another tab), the page starts over with that user's boards: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Using it

**With the mouse,** drag a card to another place in its list or to another list; a gap opens where it will land, and the board scrolls when the card nears its edge (a list scrolls near its top or bottom). Drag a list by its name. Esc while dragging puts it back. A click without dragging opens the card.

**With a finger,** rest it on a card for a moment until it lifts, then drag. A quick swipe scrolls the board instead.

**With the keyboard,** Tab into the board (one stop), then:

| Keys                  | Action                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| ↑ ↓ ← →               | Move the focus between cards and lists                                               |
| Home / End            | First / last card of the list                                                        |
| Ctrl+Shift+↑ ↓        | Move the card up / down                                                              |
| Ctrl+Shift+← →        | Move the card to the next list, at the same height (on a list's name: move the list) |
| Ctrl+Shift+Home / End | Move the card to the top / bottom of its list                                        |
| Space                 | Pick the card up; arrows carry it, Space or Enter puts it down, Esc puts it back     |
| Enter                 | Open the card (on a list's name: rename the list)                                    |
| N                     | New card at the bottom of the list (Enter adds one and stays for the next)           |
| Delete                | Delete the card (asks)                                                               |
| ?                     | The keys                                                                             |

On a Mac, Cmd works where it says Ctrl. A picked-up card is put back if the focus leaves it. Every move is read out to screen readers ("Fix login: Doing, 2 of 5").

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5179** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter valkyrie dev` starts only Valkyrie: the frontend on 127.0.0.1:5179 and the API on 127.0.0.1:3007. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter valkyrie test    # the server, the board model, keys and saving (Vitest)
```

The database is created at `data/valkyrie.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Valkyrie's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                   | Description                                                                                                             |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me                | The signed-in user: `{ username, name, accountUrl }`                                                                    |
| GET    | /api/boards            | The boards, in order, with how many cards each has                                                                      |
| POST   | /api/boards            | `{ name, color, template? }` → the new board (`409 exists` if the name is taken, ignoring case)                         |
| GET    | /api/boards/:id        | The whole board: `{ board, lists, labels, cards }`, in the order shown                                                  |
| PATCH  | /api/boards/:id        | `{ name?, color? }`                                                                                                     |
| DELETE | /api/boards/:id        | Delete a board with everything on it                                                                                    |
| POST   | /api/boards/:id/move   | `{ afterId }` (null: first) → the boards in their new order                                                             |
| GET    | /api/boards/:id/export | One board as a backup file                                                                                              |
| POST   | /api/lists             | `{ boardId, name }` → the new list, last on the board                                                                   |
| PATCH  | /api/lists/:id         | `{ name }`                                                                                                              |
| DELETE | /api/lists/:id         | Delete a list and its cards                                                                                             |
| POST   | /api/lists/:id/move    | `{ afterId }` → the board's lists in their new order                                                                    |
| POST   | /api/labels            | `{ boardId, name, color }` → the new label                                                                              |
| PATCH  | /api/labels/:id        | `{ name?, color? }`                                                                                                     |
| DELETE | /api/labels/:id        | Delete a label (it comes off its cards)                                                                                 |
| POST   | /api/cards             | `{ listId, title, afterId? }` (no `afterId`: last) → the card as the board shows it                                     |
| GET    | /api/cards/:id         | The card with its description and checklist                                                                             |
| PATCH  | /api/cards/:id         | `{ rev, title?, description?, dueDate?, labelIds? }` → the card; `409 conflict` with the current `card` if `rev` is old |
| DELETE | /api/cards/:id         | Delete a card                                                                                                           |
| POST   | /api/cards/:id/move    | `{ listId, afterId }`, the list on any of the user's boards → `{ card, droppedLabels }`                                 |
| POST   | /api/cards/:id/items   | `{ text }` → a new checklist item, last                                                                                 |
| PATCH  | /api/items/:id         | `{ text?, done? }`                                                                                                      |
| DELETE | /api/items/:id         | Delete a checklist item                                                                                                 |
| POST   | /api/items/:id/move    | `{ afterId }` → the checklist in its new order                                                                          |
| GET    | /api/export            | Every board as a backup file                                                                                            |
| POST   | /api/restore           | A backup file → `{ boards, cards }`: its boards are added as new ones                                                   |
| GET    | /healthz               | `ok` while the service runs (not served through Caddy)                                                                  |

A move names the item it now follows in its list (`afterId`, or `null` for first), never a position number; the server answers `400` if that item isn't there. Card revisions come from one counter for the whole database; moving a card within a board doesn't change it, moving it to another board does (its labels change). The page sends `X-Valkyrie-User: <username>` with every request; the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh valkyrie` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://valkyrie.<domain>`, or `https://localhost:8449` on WSL.

All users' boards are in one file, `/var/lib/valkyrie/valkyrie.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop valkyrie
sudo install -m 600 -o "$USER" /var/lib/valkyrie/valkyrie.db ~/valkyrie-backup-$(date +%Y%m%d).db
sudo systemctl start valkyrie
```

Each user can also save their own boards (sidebar → Backup, or one board from its settings). Restoring adds the file's boards as new boards; nothing already here is changed, and a name already in use gets a number ("Work (2)").

Boards belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their boards are deleted the next time Valkyrie starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them: save a backup before the rename and restore it afterwards.

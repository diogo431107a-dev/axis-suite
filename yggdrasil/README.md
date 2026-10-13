# Yggdrasil

An outliner in the style of Workflowy and Dynalist. Each signed-in user has one tree of bullets, and any bullet can be zoomed into. Yggdrasil has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own tree and nobody else's, unless someone shares a bullet with them.

| Layer    | Technology                                                                         |
| -------- | ---------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                                   |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                            |
| Data     | `/var/lib/yggdrasil/` on a server (`tree.db` and `files/`), `data/` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                    |

```
shared/protocol.ts   nodes, ops and limits: the wire format, used by the server and the page
server/
  index.ts           routes, /healthz, removed users' trees, purge timer, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  tree.ts            the only place nodes are read and written, so the one place that decides who may
                     see or change them: load, changes, ops, sharing, purge, removed users
  events.ts          server-sent events, one stream per open tab
  files.ts           uploaded files on disk: streaming them in, telling their type, sweeping leftovers
web/
  model/             the tree in the browser (store), editing commands, undo, sync, sharing, UI state
  files/             uploading files and images into a bullet, with progress and image previews
  outline/           bullets, the editor, keyboard, drag and drop, sidebar, search box, export, share
  text/              inline markup: tokenizer, renderer, dates, Ctrl+B/I/K
  search/            query language and matching
  io/                OPML, plain text and Markdown; paste and import
deploy/
  yggdrasil.service  systemd unit (sandboxed)
  yggdrasil.caddy    Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Data.** Every bullet is a row in one `nodes` table: its owner (a Heimdall username), its parent, a fractional `rank` among its siblings, its text (one line of inline markdown), a note, and completed, collapsed and starred flags. Siblings are ordered by `(rank, id)`. Ids are UUIDs made by the browser, so a new bullet exists the moment it is typed.

**Changes are ops.** The page never sends whole documents. Each edit becomes one or more ops (`create`, `update`, `move`, `delete`, `restore`) that are applied to the page's own copy of the tree at once, queued, and sent in batches. The server applies a batch in one transaction as one new revision and refuses ops it shouldn't apply: a node or parent the user can't see or may not change (see [Sharing](#sharing)), a move of a bullet into itself, fields over 100,000 characters, batches over 5,000 ops. Every op can be applied twice with the same result, so a batch whose answer got lost is simply sent again.

**Sync.** The queue goes out 300 ms after typing stops (1 s at most). While the server can't be reached it is retried with back-off (1 s up to 30 s) and the status line says "Offline — N changes waiting". The queue is kept in `localStorage`, so a tab closed while offline sends it on the next load, and leaving the page with unsent changes asks first. Each tab keeps an event stream (`GET /api/events`); when another tab or device saves something, its tabs fetch what changed (and so do the tabs of everyone the changed tree's owner shares bullets with). A field with a local change that hasn't been saved yet keeps the local value until it has.

**Drawing.** The outline is drawn as a flat list of rows (one per visible bullet), and only the rows near the window are mounted, so a tree of any size opens quickly: with 20,000 bullets all expanded, the page draws in under a second and a search answers in under 100 ms. The bullet being edited stays mounted even when scrolled away.

**Deleting.** A delete marks only the bullet itself; everything under it disappears with it and comes back with it, so undoing a delete is one op. Deleted bullets are purged for good after 30 days (at start-up and daily).

**Signing out.** If the session ends while someone is writing, a banner asks them to sign in again in a new tab; their changes wait and go out when they come back. If a different user signs in (in another tab), the page starts over with that user's tree: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Using it

Click any text to edit it; the caret lands on the character you clicked. A bullet's dot zooms into it (drag the dot to move the bullet; right-click it for its menu). The URL of a zoomed-in bullet is `/n/<id>`, so Back and Forward work and links to bullets can be shared with yourself.

| Keys                                | Action                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Enter                               | New bullet below, splitting at the caret; at the start of a bullet, a new one above |
| Shift+Enter                         | Edit the note (and back)                                                            |
| Tab / Shift+Tab                     | Indent / outdent                                                                    |
| Backspace at the start              | Delete an empty bullet, or join it to the one above                                 |
| Delete at the end                   | Join the bullet below to this one                                                   |
| ↑ / ↓                               | Previous / next bullet, from the first / last line                                  |
| Ctrl+Shift+↑ / ↓                    | Move the bullet up / down, out of its parent at either end                          |
| Ctrl+↑ / Ctrl+↓                     | Collapse / expand                                                                   |
| Alt+→ / Alt+←, also Ctrl+] / Ctrl+[ | Zoom in / out                                                                       |
| Ctrl+Enter                          | Complete / uncomplete                                                               |
| Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y     | Undo / redo                                                                         |
| Esc                                 | Select bullets as blocks (Shift+↑/↓ to extend; Tab, Delete, Ctrl+C work on them)    |
| Ctrl+F                              | Search                                                                              |
| Ctrl+B / Ctrl+I / Ctrl+K            | Bold / italic / link around the selection                                           |
| Alt+D                               | Insert today's date                                                                 |
| Alt+S                               | Star / unstar (also on bullets selected with Esc)                                   |

**Text.** The syntax is Dynalist's: `**bold**`, `__italic__`, `~~strike~~`, `` `code` ``, `[text](url)` and bare URLs, `#tags`, `@mentions`, and dates as `!(2026-10-11)` or `!(2026-10-11 14:30)`. Dates show as chips (Today, Tomorrow, a weekday; red when overdue) and open a date picker when clicked. Links only ever point to `http(s):` or `mailto:` addresses, or to a file uploaded to Yggdrasil.

**Search** (Ctrl+F) looks inside the zoomed-in bullet and combines: words (all must match, ignoring case and accents), `"exact phrases"`, `-word` to exclude, `#tag`, `@who`, `is:completed`, `has:note`, `has:date`, `has:image`, `has:file`, `date:today`, `date:tomorrow`, `date:overdue`, `before:YYYY-MM-DD` and `after:YYYY-MM-DD`.

The sidebar's **Tags** list follows the same scope: it shows the tags inside the zoomed-in bullet (collapsed bullets included, completed ones only while they are shown), with how many bullets carry each, and clicking one searches for it. Zoom out to Home for every tag in the tree. Starred and top-level bullets are always listed.

**OPML.** Import an OPML file from the sidebar, or drop it on the outline. Everything lands under a new bullet "Imported <file> <date>" in the zoomed-in bullet, as one undo step. Dynalist exports keep their markdown; Workflowy's HTML formatting becomes markdown. Export (sidebar, or a bullet's menu) writes a bullet or the whole tree as OPML 2.0, plain indented text or Markdown.

## Images and files

Paste an image (a screenshot, say) or files into a bullet, drop files on a bullet, or use its menu → **Attach files…**. Each file is uploaded (at most 200 MB; a bar shows how far along it is) and goes into the text at the caret, or in the note if that is where you are typing:

- `![photo.jpg](/api/files/<id>)` shows an image. The outline shows a smaller copy (the browser makes one, about 1,200 px, when it uploads a large photo); clicking it opens the original in a new tab.
- `[report.pdf](/api/files/<id>)` shows a chip that downloads the file.

The markup is ordinary text, so undo, copy and paste, moving bullets, search (by file name) and export all treat it as text. Exports turn the addresses into full links back to Yggdrasil. Undoing an insert takes out the markup; the file itself stays for 30 days, so redo still works. A file nothing refers to for 30 days is deleted, as are files in a bullet deleted (and purged) for good.

A file belongs to the tree it was uploaded into (an editor's upload into a shared bullet is the owner's). Whoever sees a bullet that refers to it can open it; anyone else gets 404. Copying a shared bullet's image into your own outline copies the reference, not the file: you see it while the bullet stays shared with you.

Only PNG, JPEG, GIF, WebP and AVIF images are shown in the page; every other file (SVG and HTML included) is only ever downloaded, never opened as a page of Yggdrasil's. A file's type is read from its first bytes, not taken from the browser.

## Sharing

The owner of a bullet can share it, with everything under it (bullets added later included), with other Heimdall users: the bullet's menu → **Share…**. For each person they choose:

- **Can read**: the bullet shows up under **Shared with me** in that person's sidebar; clicking it zooms into it, read only.
- **Can edit**: they can also change the text, notes and completion of the bullet and everything under it, and add, move and delete bullets inside it. Two people typing in the same bullet are handled like two tabs: the last change saved wins.

Only the owner can move or delete the shared bullet itself, or change who it is shared with. Someone a bullet is shared with can take it off their own list (the ✕ beside it under **Shared with me**, **Remove from my list**), which stops the sharing for them. Each person collapses, expands and stars a shared bullet for themselves; that changes nothing for anyone else. Bullets added by someone else still belong to the owner's tree, and nothing moves between two people's outlines (copy and paste still work). The owner sees a small people icon on the bullets they share, which are also listed under **Shared by me**.

A shared bullet stays out of the recipient's own outline: Home, its search, its tags and the whole-outline export are theirs alone. When what they may see changes (a share is added or removed, a bullet is moved into or out of a shared one, or a shared bullet or one above it is deleted or restored), their page loads the tree again.

The people to choose from are Heimdall's usernames, which the installer hands to Yggdrasil (`AXIS_USERS`). In development they come from [`dev.env`](dev.env), a copy of Heimdall's demo users.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5174** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter yggdrasil dev` starts only Yggdrasil: the frontend on 127.0.0.1:5174 and the API on 127.0.0.1:3002. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter yggdrasil test    # the server and browser tests (Vitest)
```

The database is created at `data/tree.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Yggdrasil's own origin (`403` otherwise), except uploads: they send the file as it is, so they must carry `X-Yggdrasil-User` instead, a header another site's page can't send without asking first. Responses are never cached, except files, which never change.

| Method | Path                            | Description                                                                                                                                                                      |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me                         | The signed-in user: `{ username, name, accountUrl }`                                                                                                                             |
| GET    | /api/tree                       | `{ rev, nodes, shares }`: every bullet the user can see, and the bullets they share and those shared with them                                                                   |
| GET    | /api/changes?since=N            | `{ rev, nodes, shares }`: bullets changed after revision N, deleted ones included; `{ reset: true }` if N is older than the last purge, or what the user may see changed since   |
| POST   | /api/ops                        | `{ clientId, ops }` → `{ rev, rejected: [{ index, reason }] }`: one transaction, one revision (`rev` is null if nothing changed)                                                 |
| GET    | /api/users                      | The usernames the user can share with                                                                                                                                            |
| GET    | /api/nodes/:id/shares           | Who a bullet of the user's own is shared with: `[{ username, permission }]`                                                                                                      |
| PUT    | /api/nodes/:id/shares           | Share it (owner only): `[{ username, permission }]` (`read` or `write`), replacing the list                                                                                      |
| DELETE | /api/nodes/:id/shares/:username | Stop sharing with one person (the owner, or that person)                                                                                                                         |
| POST   | /api/files?node=ID&name=NAME    | Upload a file (the raw bytes, `application/octet-stream`, at most 200 MB) into a bullet the user may change → `201 { id, name, type, size }`; `507` when the disk is nearly full |
| PUT    | /api/files/:id/preview          | An image's smaller copy (WebP or JPEG, at most 1 MB), once, from whoever uploaded it                                                                                             |
| GET    | /api/files/:id                  | The file; images inline, anything else as a download                                                                                                                             |
| GET    | /api/files/:id/preview          | The image's preview, or the file itself if it has none                                                                                                                           |
| GET    | /api/events                     | Server-sent events: `rev` events `{ rev, clientId }`, a heartbeat every 25 s; closed after 10 minutes so the reconnect asks Heimdall again                                       |
| GET    | /healthz                        | `ok` while the service runs (not served through Caddy)                                                                                                                           |

The page sends `X-Yggdrasil-User: <username>` with every request (`?user=` for the event stream); the API answers `409` if someone else is signed in. The op format is in [`shared/protocol.ts`](shared/protocol.ts).

In `shares`, `byMe` lists the user's bullets that are shared (`{ id, shares }`) and `withMe` the bullets shared with them (`{ id, owner, permission }`). A shared bullet comes to its recipients with `parentId: null`, and with their own `collapsed` and `starred`. A sharing request about a bullet the user can't see answers `404`, the same as one that doesn't exist; one they can see but not share answers `403`.

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh yggdrasil` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://yggdrasil.<domain>`, or `https://localhost:8444` on WSL.

All users' trees are in one file, `/var/lib/yggdrasil/tree.db` (no write-ahead log), and their uploaded files in `/var/lib/yggdrasil/files/`, one file each, named by id. The two go together: back up the whole folder. It holds everyone's private outlines, so keep backups where only you can read them, with the service stopped (`/var/lib/private/yggdrasil` is where systemd really keeps it):

```bash
sudo systemctl stop yggdrasil
sudo tar -czf ~/yggdrasil-backup-$(date +%Y%m%d).tar.gz -C /var/lib/private yggdrasil
sudo systemctl start yggdrasil
sudo chown "$USER": ~/yggdrasil-backup-*.tar.gz && chmod 600 ~/yggdrasil-backup-*.tar.gz
```

Uploads are refused while they would leave less than 2 GB free on the disk (the mail server needs it too). To change that, set `YGGDRASIL_MIN_FREE_MB` in a drop-in, which the installer leaves alone: `sudo SYSTEMD_EDITOR=vim systemctl edit yggdrasil`, add `[Service]` and `Environment=YGGDRASIL_MIN_FREE_MB=4096`, then `sudo systemctl restart yggdrasil`.

Bullets belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their tree (and its files) is deleted the next time Yggdrasil starts (the installer restarts it when the list of users changes), and bullets shared with them stop being shared. Bullets they added inside someone else's shared bullet stay: they belong to that tree's owner. Renaming a user counts as removing them: the tree under the old name is deleted.

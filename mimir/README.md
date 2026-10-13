# Mimir

Mind maps. Each user has any number of maps; a map starts from one idea in the middle and branches out to both sides, laid out by itself as it grows. Nodes hold text, and relationship arrows can join any two of them. Mimir has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own maps and nobody else's.

| Layer    | Technology                                                            |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4; the map is drawn as SVG             |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`               |
| Database | `/var/lib/mimir/mimir.db` on a server, `data/mimir.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                       |

```
shared/
  protocol.ts        API types, ops and limits: the wire format, used by the server and the page
server/
  index.ts           routes, /healthz, removed users' maps, the daily purge, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  ops.ts             applies batches of changes to one map (the only place nodes and arrows are written)
  maps.ts            the map list, loading, catching up, backup and restore, purging
  ranks.ts           the order of the maps in the sidebar: fractional indexes
web/
  model/             the open map in the page, editing commands, undo, and the save queue
  layout/            where each node goes, text wrapping, and the shapes the map is drawn with
  map/
    MapView.tsx      a map: header, drawing, keys, mouse and finger
    MapCanvas.tsx    the SVG drawing
    keys.ts          what each key means
    navigate.ts      where the arrow keys go
    drop.ts          where a dragged node lands
    view.ts          panning and zooming
  io/                OPML, clipboard text, the PNG picture
  text/              links in a node's text; markup from Yggdrasil as plain text
deploy/
  mimir.service      systemd unit (sandboxed)
  mimir.caddy        Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Maps.** A map's name is the first line of its centre node. Maps are ordered in the sidebar by dragging them, or with Ctrl+Shift+↑/↓ on one. Up to 200 maps, 5,000 nodes and 500 arrows in a map, and 100,000 nodes in all.

**The layout is automatic.** The centre sits in the middle; its children (the main branches) go to the right or the left, and everything under a main branch grows the same way. A new main branch goes to the shorter side; after that a branch stays on its side until it is moved across (Ctrl+Shift+← or →, or a drag over the centre). Nodes hold text of any number of lines; long text wraps. Web and mail addresses in the text are underlined and open with a click (or O).

**Folding** hides a node's branch: the node shows a badge with how many nodes are folded inside ("+12"); a click on it unfolds.

**Relationship arrows** join any two nodes, outside the tree, with an optional label. An arrow whose end is folded away points, faded, at the nearest node shown above it.

**Look.** One colour: the centre in fuchsia, main branches in white boxes, deeper nodes as plain text. Zoomed far out, the text of deeper nodes becomes grey bars.

**Saving.** Every change shows at once and is saved behind it: changes wait in one queue for the whole page, are sent a moment after typing stops, and are retried while the network is down. The queue is kept in the browser, so changes made just before a tab closed are sent by the next Mimir tab opened. Each change is an op (create, update, move, delete, restore, and the same for arrows) that can be applied twice with the same result. The map catches up with changes made elsewhere (another tab or device) when the window gets the focus back.

**Undo.** Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes, everything done to the open map since it was opened. Deleting a node therefore asks nothing; a notice says what went, with an Undo button. Deleted nodes are kept on the server for 30 days, then purged. Deleting a whole map asks first, and is final.

**Signing out.** If the session ends, a banner asks to sign in again in a new tab; changes wait in the page meanwhile. If a different user signs in (in another tab), the page starts over with that user's maps: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Using it

**With the keyboard,** Tab into the map (one stop); a node is selected, and these act on it:

| Keys                            | Action                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| ↑ ↓                             | The node above / below, at the same depth on the same side                          |
| ← →                             | Toward the root: the parent. Away from it: a child. From the root: into that side   |
| Home                            | The centre of the map                                                               |
| Enter, F2, double-click         | Edit the text                                                                       |
| While editing: Enter            | Save (Shift+Enter: a new line; Esc: leave it as it was)                             |
| While editing: Tab / Ctrl+Enter | Save, and add a child / a node below                                                |
| Tab, Insert                     | Add a child                                                                         |
| N / Shift+N                     | Add a node below / above (on the centre: a new branch on the shorter side)          |
| Ctrl+Shift+↑ ↓                  | Move the node up / down                                                             |
| Ctrl+Shift+← →                  | Move it one level toward / away from the root (a main branch crosses sides)         |
| Ctrl+Shift+Home / End           | Move it to the top / bottom of its siblings                                         |
| Space                           | Fold / unfold                                                                       |
| Delete, Backspace               | Delete the node and its branch (Ctrl+Z brings it back)                              |
| A                               | Draw an arrow from this node: pick the other node with the arrows or a click, Enter |
| Shift+A                         | Go through this node's arrows; then Enter edits the label, Delete removes the arrow |
| O                               | Open the link in the node                                                           |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y   | Undo / redo                                                                         |
| Ctrl+C / X / V                  | Copy / cut / paste branches, as indented text (Yggdrasil reads it too)              |
| + / − / 0                       | Zoom in / out / fit the whole map                                                   |
| Shift+F10, Menu key             | The node's menu                                                                     |
| Esc                             | Clear the selection (then Tab leaves the map)                                       |
| ?                               | The keys                                                                            |

Typing a letter on a selected node doesn't start editing: letters are shortcuts. A new node exists only once Enter saves it; Esc leaves nothing behind. On a Mac, Cmd works where it says Ctrl; Ctrl+= and Ctrl+0 stay the browser's own zoom. Every selection and change is read out to screen readers ("Hotels, level 1, 2 of 3 on the left, folded, 4 inside").

**With the mouse,** drag the background (or use the wheel) to move around, Ctrl+wheel or a trackpad pinch to zoom. Drag a node onto another to put it inside, between two to put it there, or over the centre to make it a main branch on that side; a line or a highlight shows where it will land, and the map moves along near the edges. Esc while dragging puts it back. Double-click edits; right-click opens the node's menu.

**With a finger,** a tap selects, a double tap edits, one finger moves around, two fingers zoom. Hold a node for a moment until it lifts, then drag it. A small toolbar adds, edits, draws arrows and opens the node's menu.

**Copy and paste** use the same indented "- " lines as Yggdrasil, so bullets copied there paste here as a branch, and back. Markup becomes plain text; a link keeps its address, as "label (https://…)". Lines without a "- " under a bullet become further lines of that node.

**Import and export** are in the map's menu (⋯) and the node's menu:

- **OPML** in, as a new map (the import button in the sidebar) or under the selected node. One top-level outline becomes the centre; several hang from a centre named after the file. Notes and completion marks have no place in a map, so they are left out (the import says how many). Out: the whole map or one branch; OPML has no place for arrows.
- **PNG**: a picture of the map as shown (folded branches stay folded), or of one branch, at twice the screen's size. A very big map comes out smaller (browsers cap a picture's size), and a notice says so.
- **Backup** (sidebar): every map with its nodes and arrows in one JSON file.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5181** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter mimir dev` starts only Mimir: the frontend on 127.0.0.1:5181 and the API on 127.0.0.1:3009. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter mimir test    # the server, layout, keys, drops, commands, saving, OPML and pictures (Vitest)
```

The database is created at `data/mimir.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Mimir's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                  | Description                                                                                          |
| ------ | --------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | /api/me               | The signed-in user: `{ username, name, accountUrl }`                                                 |
| GET    | /api/maps             | The maps, in order: `{ id, name, updatedAt }`                                                        |
| POST   | /api/maps             | `{ text? }` → a new map holding just its centre: `{ map, rev, nodes, arrows }`                       |
| GET    | /api/maps/:id         | The map: `{ map, rev, nodes, arrows }`; nodes inside deleted branches are left out                   |
| DELETE | /api/maps/:id         | Delete a map with everything in it                                                                   |
| POST   | /api/maps/:id/move    | `{ afterId }` (null: first) → the maps in their new order                                            |
| POST   | /api/maps/:id/ops     | `{ ops }` (at most 2,000) → `{ rev, rejected: [{ index, reason }] }`                                 |
| GET    | /api/maps/:id/changes | `?since=<rev>` → the nodes and arrows changed since, deleted ones included; `{ reset: true }` if old |
| GET    | /api/maps/:id/export  | One map as a backup file                                                                             |
| GET    | /api/export           | Every map as a backup file                                                                           |
| POST   | /api/restore          | A backup file → `{ maps, nodes, droppedArrows, ids }`: its maps are added as new ones                |
| GET    | /healthz              | `ok` while the service runs (not served through Caddy)                                               |

Node and arrow ids are UUIDs made by the page. A batch of ops is applied in one transaction as one new revision of the map; each op is checked on its own (the centre can't be moved, deleted or folded; only main branches have a side; nothing goes inside itself; both ends of an arrow are in the map), and the refused ones are listed while the rest apply. Revisions count per map. The page sends `X-Mimir-User: <username>` with every request; the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh mimir` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://mimir.<domain>`, or `https://localhost:8451` on WSL.

All users' maps are in one file, `/var/lib/mimir/mimir.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop mimir
sudo install -m 600 -o "$USER" /var/lib/mimir/mimir.db ~/mimir-backup-$(date +%Y%m%d).db
sudo systemctl start mimir
```

Each user can also save their own maps (sidebar → Backup). Restoring adds the file's maps as new maps; nothing already here is changed.

Maps belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their maps are deleted the next time Mimir starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them: save a backup before the rename and restore it afterwards.

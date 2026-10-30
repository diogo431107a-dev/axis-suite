# Every Man is a Star

The people you know and their families, charted as a night sky. Each bright star is someone you know. The smaller stars around them are the family you have learned about, tied by how they relate to that person ("Bob's brother's wife"). When you find out that two people from different families are related, a dotted line connects them. Star has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own sky and nobody else's.

| Layer    | Technology                                                                      |
| -------- | ------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8; the sky is SVG over a canvas, drawn outside React             |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                         |
| Database | `/var/lib/star/star.db` on a server, `data/star.db` in development              |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                 |
| Address  | `https://star.<domain>`; https://localhost:8454 in WSL; port 5184 in `pnpm dev` |

```
shared/
  protocol.ts        API types, ops and limits: the wire format, used by the server and the page
server/
  index.ts           routes, /healthz, removed users' skies, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  sky.ts             loading a sky, and checking and applying batches of ops
web/
  App.tsx            signing in, loading, and the page: what is selected, connect mode, leaving and returning
  api.ts             fetch for the API
  sync.ts            the save queue
  panel/             the panel (overview and one star) and the search box
  sky/
    model.ts         who is whose, the Greek letters, "Bob's brother's wife", search
    layout.ts        the forces that spread relatives around their star
    store.ts         the sky in the page, and every change to it
    scene.ts         drawing the sky; pan, zoom, pinch, drag; the starfield
  ui/                the dialog and the About box
deploy/
  star.service       systemd unit (sandboxed)
  star.caddy         Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Stars.** A main star is someone the user knows. Any star can have relatives around it, and those can have relatives too. A star has a name, a memo, and (unless it is a main star) what it is to the star it is tied to. The relation is free text, with suggestions. Up to 2,000 stars and 5,000 connections in a sky.

**Connections** join two stars that aren't already tied, usually in different families, and say how: "Laura is Carla's sister". The same two stars can be connected only once.

**Make a main star** is for when you get to know a relative yourself: the star gets its own constellation, and the old tie becomes a connection.

**Removing a star** asks first, and takes every star charted around it and all their connections. There is no undo.

**The layout.** Main stars stay where they are put; dragging one takes its constellation along. Relatives spread around their star by themselves. Positions are saved when the stars come to rest, so a sky looks the same on every device. Opening a sky doesn't run the layout, so it writes nothing.

**Saving.** Every change shows at once and is saved behind it, in order, a moment after typing stops. A batch of changes is saved whole or not at all, and sending one twice applies it once. While the server can't be reached the changes wait and are sent again, with a notice if that takes more than a few seconds, and a warning on closing the tab. If the server refuses a change, the page shows the sky as last saved and says so. The sky catches up with changes made elsewhere (another tab or device) when the window gets the focus back.

**Signing out.** If the session ends, a notice asks to sign in again in a new tab; changes wait in the page meanwhile. If a different user signs in (in another tab), the page starts over with that user's sky: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

**Look.** It is always night here: one dark theme, no light one. The fonts (Cinzel and Jost) are part of the build, so the page loads nothing from anywhere else, and the site runs under the suite's normal CSP. That is why the drawing code sets styles through `element.style`, never a `style` attribute.

**Narrow windows.** Below 768px the panel is a bottom sheet, not the slide-in drawer of the suite's other modules. This is on purpose: the sky stays in view above it, which connecting two stars needs. Selecting a star flies it into the part of the sky left visible.

## Installing and data

```bash
sudo bash deploy/install.sh star
```

With a real domain, `star.<domain>` must point at the server first. Everything is in `/var/lib/star/star.db`, one file. Back it up with the service stopped, as the [suite README](../README.md#operating-it) describes. Memos are private notes about other people, and they are not encrypted, so keep the copies where only you can read them.

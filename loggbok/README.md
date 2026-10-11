# Loggbok

A notes manager. Loggbok has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own notes and nobody else's.

| Layer    | Technology                                                              |
| -------- | ----------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                        |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                 |
| Database | `/var/lib/loggbok/notes.db` on a server, `data/notes.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                         |

```
server/
  index.ts        API routes
  access.ts       who may see / change which note (the only place notes are queried)
  db.ts           SQLite schema and migrations (PRAGMA user_version)
web/
  App.tsx         the whole UI
deploy/
  loggbok.service systemd unit (sandboxed)
  loggbok.caddy   Caddy site: /api to the service, everything else from dist/web
  hooks.sh        moves installs from before the suite installer
```

## How sign-in works

1. Every `/api` request goes through `requireUser` from `@axis-suite/heimdall-client/server`. It forwards the browser's cookie to Heimdall's `GET /whoami` and gets back `{ username, name }`. Closing a session in Heimdall therefore signs the user out of Loggbok immediately.
2. If nobody is signed in, the API answers `401 { loginUrl }`. The page then sends the browser to Heimdall's `/?next=<this page>`, and Heimdall sends it back after sign-in.
3. If the session ends while someone is writing, a banner asks them to sign in again in a new tab. The draft stays. If a _different_ user signs in, the page reloads with that user's notes.

Notes belong to a Heimdall **username**. Renaming a user in Heimdall's `users.ts` leaves their old notes behind under the old name. Changing only the display name is fine.

## Local development

From the suite's root, `pnpm dev` starts Heimdall and Loggbok together. Open **http://127.0.0.1:5173** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter loggbok dev` starts only Loggbok: the frontend on 127.0.0.1:5173 and the API on 127.0.0.1:3001. It still needs Heimdall on 127.0.0.1:3000; set `HEIMDALL_INTERNAL_URL` and `HEIMDALL_PUBLIC_URL` if it runs elsewhere.

The database is created at `data/notes.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Loggbok's own origin (`403` otherwise).

| Method | Path           | Description                                            |
| ------ | -------------- | ------------------------------------------------------ |
| GET    | /api/me        | The signed-in user: `{ username, name, accountUrl }`   |
| GET    | /api/notes     | List the notes you can see                             |
| GET    | /api/notes?q=  | Search them (title + body)                             |
| POST   | /api/notes     | Create a note: `{ title, content }`                    |
| PUT    | /api/notes/:id | Update a note: `{ title, content }`                    |
| DELETE | /api/notes/:id | Delete a note                                          |
| GET    | /healthz       | `ok` while the service runs (not served through Caddy) |

The server assigns note ids and timestamps. Each note comes back with `owner` (a Heimdall username) and `role` (your access to it, currently always `owner`). A note you can't see answers `404`, the same as one that doesn't exist.

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh loggbok` (see the [suite README](../README.md#installing-on-a-server)). The installer builds the API and the frontend into `/opt/loggbok`, and Caddy serves the frontend from `/opt/loggbok/dist/web`.

All users' notes are in one file, `/var/lib/loggbok/notes.db`. It holds everyone's private notes, so keep backups where only you can read them (see _Operating it_ in the suite README).

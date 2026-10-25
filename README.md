# Axis Suite

Small self-hosted web apps ("modules") that share one sign-in (all but Saga, which has its own players). Everything runs on a single Debian 13 server behind Caddy.

| Module                           | What it is                                                                                               | Port | Local port |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| [Heimdall](heimdall/README.md)   | The sign-in service. It holds the user accounts and sessions; the other modules ask it who is signed in. | 3000 | 443        |
| [Loggbok](loggbok/README.md)     | A notes manager. Each signed-in user sees only their own notes.                                          | 3001 | 8443       |
| [Yggdrasil](yggdrasil/README.md) | An outliner like Workflowy and Dynalist: one tree of bullets per user, with OPML in and out.             | 3002 | 8444       |
| [Janus](janus/README.md)         | A password manager like KeePass, with TOTP codes: one encrypted vault per user.                          | 3003 | 8445       |
| [Papyrus](papyrus/README.md)     | A journal: a page for every day in each of a user's journals, with moods, #tags and "On this day".       | 3004 | 8446       |
| [Vinr](vinr/README.md)           | A contacts manager: phones, emails, addresses, birthdays and groups, with vCard in and out.              | 3005 | 8447       |
| [Chronos](chronos/README.md)     | A calendar: several calendars to show or hide, ISO dates and weeks, and .ics files in and out.           | 3006 | 8448       |
| [Valkyrie](valkyrie/README.md)   | A kanban: boards of lists and cards, moved by mouse, finger or keyboard, with labels and checklists.     | 3007 | 8449       |
| [Althing](althing/README.md)     | A real-time chat: a lobby, rooms anyone can open, and direct messages, all kept on record.               | 3008 | 8450       |
| [Mimir](mimir/README.md)         | Mind maps that lay themselves out from the centre to both sides, with arrows, OPML in and out, and PNG.  | 3009 | 8451       |
| [Urd](urd/README.md)             | A time tracker that stays open all day: one big clock, Play/Stop, and time and interruptions per period. | 3010 | 8452       |
| [Saga](saga/README.md)           | Habits Saga, a habit tracker played as a fantasy game, with its own players and a public ranking.        | 3011 | 8453       |

Shared code lives in `packages/`:

| Package                                                           | What it is                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [@axis-suite/heimdall-client](packages/heimdall-client/README.md) | How a module learns who is signed in (server middleware) and sends people to sign in (browser helpers). |

Every module is TypeScript on Node.js 22, built with pnpm, installed by the same installer and run the same way. The ports are registered in [`deploy/modules.conf`](deploy/modules.conf).

## How the modules connect

```
browser ──https──▶ Caddy ──▶ heimdall   127.0.0.1:3000   accounts, sessions, sign-in page
                        ├──▶ loggbok    127.0.0.1:3001   notes API + static frontend
                        ├──▶ yggdrasil  127.0.0.1:3002   outliner API, live updates + static frontend
                        ├──▶ janus      127.0.0.1:3003   password manager API + static frontend
                        ├──▶ papyrus    127.0.0.1:3004   journal API + static frontend
                        ├──▶ vinr       127.0.0.1:3005   contacts API + static frontend
                        ├──▶ chronos    127.0.0.1:3006   calendar API + static frontend
                        ├──▶ valkyrie   127.0.0.1:3007   kanban API + static frontend
                        ├──▶ althing    127.0.0.1:3008   chat API, live updates + static frontend
                        ├──▶ mimir      127.0.0.1:3009   mind-map API + static frontend
                        ├──▶ urd        127.0.0.1:3010   time-tracker API, live updates + static frontend
                        └──▶ saga       127.0.0.1:3011   game API + static frontend (its own accounts)

each module's API ── GET /whoami ──▶ heimdall (server to server, with the browser's cookie)
althing's API     ── GET /online ──▶ heimdall (who has a live session, for the "online" list)
```

Saga is the exception: its players are its own, so it never asks Heimdall anything. What follows is about every other module.

- **Shared cookie.** Heimdall sets the session cookie `heimdall_sid`. On a real domain it is scoped to the parent domain (`COOKIE_DOMAIN`), so browsers send it to every module's subdomain. On `localhost` or an IP address all modules share one host, so the cookie needs no domain.
- **Who is signed in.** Each module's API runs `requireUser` from `@axis-suite/heimdall-client/server`, which forwards the browser's cookie to Heimdall's `GET /whoami` on every request. Closing the session in Heimdall therefore signs the user out of every module at once. Each of those requests also counts as use: a session ends after 48 hours without any, and 14 days after sign-in at the latest.
- **Return after sign-in.** When nobody is signed in, the module's page sends the browser to Heimdall's `/?next=<page>`. Heimdall only sends users back to origins that were registered with it: the installer gives each module a systemd drop-in, `/etc/systemd/system/heimdall.service.d/origin-<module>.conf`, setting `RETURN_ORIGIN_<MODULE>`.
- **Removed users leave nothing behind.** The installer writes Heimdall's usernames into `/etc/axis-suite/suite.env` as `AXIS_USERS`, and restarts every module when that list changes. When a module starts, it deletes the data of every owner not on the list (`knownUsers()` from `@axis-suite/heimdall-client/server`), logs what it deleted, and compacts its database. So removing or renaming a user in Heimdall deletes their data everywhere on the next deploy. Without the list (development, or Heimdall not installed yet), nothing is deleted.
- **Keep them in step.** `/whoami`, the cookie and the `?next=` flow are the contract between Heimdall and `packages/heimdall-client`. Change both in the same commit.

## Repository layout

```
deploy/              shared by every module's installation
  install.sh         installs or updates one module: sudo bash deploy/install.sh <module> [domain]
  modules.conf       every module and its ports
  node.sh            the suite's Node.js version (and pnpm, from package.json)
  Caddyfile          the main Caddy config; each module adds a site to /etc/caddy/sites.d/
packages/
  heimdall-client/   shared sign-in code for modules
heimdall/            sign-in service
loggbok/             notes
yggdrasil/           outliner
janus/               password manager
papyrus/             journal
vinr/                contacts
chronos/             calendar
valkyrie/            kanban
althing/             chat
mimir/               mind maps
urd/                 time tracker
saga/                Habits Saga, the game
```

Every module has the same shape:

```
<module>/
  package.json       scripts: dev, build, typecheck, start; "dependencies" = what the server needs at runtime
  tsconfig.json      extends ../tsconfig.base.json (Node code) or ../tsconfig.web.json (browser code)
  server/index.ts    the service. Listens on $HOST:$PORT, answers GET /healthz, keeps data in $STATE_DIRECTORY
  web/               optional frontend (Vite), built to dist/web
  deploy/
    <module>.service systemd unit: runs /opt/<module>/dist/server/index.js as a throwaway user
    <module>.caddy   Caddy site template (@SITE@, @PORT@, @APP_DIR@ are filled in by the installer)
  README.md
```

Code is formatted by Prettier and linted by oxlint, with one config for the whole suite. Relative imports name the `.ts` file (`./db.ts`); the build rewrites them to `.js`, and in development Node runs the TypeScript directly.

## Development

Requires Node.js 22.18 or newer and pnpm (`npm install -g pnpm`; the version in `package.json` is used automatically).

```bash
pnpm install
pnpm dev          # every module at once; open http://127.0.0.1:5173 for Loggbok, :5174 for Yggdrasil, :5175 for Janus, :5176 for Papyrus, :5177 for Vinr, :5178 for Chronos, :5179 for Valkyrie, :5180 for Althing, :5181 for Mimir, :5182 for Urd, :5183 for Saga
```

Use `127.0.0.1`, not `localhost`: browsers send Heimdall's cookie (`127.0.0.1:3000`) to the other modules only on the same host. Demo accounts: `odin` / `allfather-demo`, `freya` / `folkvangr-demo`, `john` / `john-demo`. Local data goes in each module's `data/` folder, which git ignores.

```bash
pnpm check        # formatting, lint, type-check and tests, as CI runs them
pnpm test         # every module's tests
pnpm format       # fix the formatting
pnpm build        # build everything
pnpm --filter loggbok dev     # one module (and nothing else)
```

## Installing on a server

The installer builds a module from this checkout into `/opt/<module>`, installs its systemd service and Caddy site, and checks that it answers. It is safe to re-run after every change. The first run on a server also needs the suite's domain, which decides where every module is served:

| Domain given   | Each module is served at               | Certificates                         |
| -------------- | -------------------------------------- | ------------------------------------ |
| `example.com`  | `https://<module>.example.com`         | Let's Encrypt (needs DNS, see below) |
| `localhost`    | `https://localhost:<local port>` (WSL) | Caddy's local CA                     |
| `203.0.113.10` | `https://203.0.113.10:<local port>`    | self-signed                          |

Install Heimdall first, then the other modules in any order.

### VPS (Debian 13)

**1. DNS.** Point `heimdall.example.com`, `loggbok.example.com`, … at the VPS with A records (or one wildcard `*.example.com`). Caddy then gets the certificates automatically.

**2. Firewall.** Ports 80 and 443 must be reachable. If the server already has a firewall, add 80/443 to it rather than installing a new one: a new firewall that only allows SSH and web traffic blocks everything else the server does, mail included. If you do use `ufw`, allow every service _before_ enabling it:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp
# Mail server on the same box? Also allow its ports, e.g.:
sudo ufw allow 25,465,587,993,995,143,110/tcp
sudo ufw status verbose   # check the list, then:
sudo ufw enable
```

**3. Clone and install**, in your home directory on the VPS:

```bash
git clone https://github.com/diogo431107a-dev/axis-suite.git
sudo bash axis-suite/deploy/install.sh heimdall example.com
sudo bash axis-suite/deploy/install.sh loggbok
sudo bash axis-suite/deploy/install.sh yggdrasil
sudo bash axis-suite/deploy/install.sh janus
sudo bash axis-suite/deploy/install.sh papyrus
sudo bash axis-suite/deploy/install.sh vinr
sudo bash axis-suite/deploy/install.sh chronos
sudo bash axis-suite/deploy/install.sh valkyrie
sudo bash axis-suite/deploy/install.sh althing
sudo bash axis-suite/deploy/install.sh mimir
sudo bash axis-suite/deploy/install.sh urd
sudo bash axis-suite/deploy/install.sh saga
```

Janus's first install makes its encryption key, `/etc/axis-suite/janus.key`. Back it up right away, apart from the server: without it, nobody can read the vaults (see [Janus](janus/README.md#installing-and-data)).

To update: `cd ~/axis-suite && git pull`, then re-run the installer for each module that changed.

> The installer owns `/etc/caddy/Caddyfile` and rewrites it on every run (an unrelated one is backed up first). Anything else Caddy should serve goes in its own file in `/etc/caddy/sites.d/`; those are kept.

### WSL test install

From inside WSL, as your normal user:

```bash
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh heimdall localhost
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh loggbok
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh yggdrasil
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh janus
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh papyrus
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh vinr
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh chronos
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh valkyrie
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh althing
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh mimir
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh urd
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh saga
```

Heimdall is then at https://localhost, Loggbok at https://localhost:8443, Yggdrasil at https://localhost:8444, Janus at https://localhost:8445, Papyrus at https://localhost:8446, Vinr at https://localhost:8447, Chronos at https://localhost:8448, Valkyrie at https://localhost:8449, Althing at https://localhost:8450, Mimir at https://localhost:8451, Urd at https://localhost:8452 and Saga at https://localhost:8453. Caddy signs `localhost` with its own local CA, which Windows doesn't trust, so browsers warn until you import its root certificate into Windows' _Trusted Root Certification Authorities_. It is at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`; that folder is root-only, so copy the file out first, e.g. `sudo cp …/root.crt /mnt/c/Users/<you>/caddy-root.crt`.

## Operating it

```bash
systemctl status heimdall loggbok yggdrasil janus papyrus vinr chronos valkyrie althing mimir urd saga   # running?
journalctl -u loggbok -f                                                          # a module's log
sudo systemctl restart loggbok                                                    # restart one module
cat /etc/axis-suite/suite.env                                                     # the domain, URLs and usernames every module was given
grep '"version"' /opt/*/package.json                                             # the version of each installed module (also in its About box)
```

Each module keeps its data in its own systemd `StateDirectory`, `/var/lib/<module>`, outside `/opt` and readable only by that module's service:

| Module    | Data                                                                   | Location                        |
| --------- | ---------------------------------------------------------------------- | ------------------------------- |
| Heimdall  | sessions                                                               | `/var/lib/heimdall/`            |
| Loggbok   | every user's notes                                                     | `/var/lib/loggbok/notes.db`     |
| Yggdrasil | every user's outline, and the files uploaded into it                   | `/var/lib/yggdrasil/`           |
| Janus     | every user's vault (encrypted; the key is `/etc/axis-suite/janus.key`) | `/var/lib/janus/janus.db`       |
| Papyrus   | every user's journals                                                  | `/var/lib/papyrus/papyrus.db`   |
| Vinr      | every user's contacts                                                  | `/var/lib/vinr/vinr.db`         |
| Chronos   | every user's calendars                                                 | `/var/lib/chronos/chronos.db`   |
| Valkyrie  | every user's boards                                                    | `/var/lib/valkyrie/valkyrie.db` |
| Althing   | every message, room and profile, kept on record                        | `/var/lib/althing/althing.db`   |
| Mimir     | every user's maps                                                      | `/var/lib/mimir/mimir.db`       |
| Urd       | every user's sessions and projects                                     | `/var/lib/urd/urd.db`           |
| Saga      | every player's account and game, and the invite codes                  | `/var/lib/saga/saga.db`         |

Back up a module's data with its service stopped, and keep the copies where only you can read them:

```bash
sudo systemctl stop loggbok
sudo install -m 600 -o "$USER" /var/lib/loggbok/notes.db ~/notes-backup-$(date +%Y%m%d).db
sudo systemctl start loggbok
```

## Versions and changelogs

Each module has its own version, kept in its `package.json`, and its own `CHANGELOG.md`, which says in plain words what changed and what to do when upgrading. The suite as a whole has one too: the root `package.json` and [`CHANGELOG.md`](CHANGELOG.md), which lists the version of every module in each suite version. Versions started on 2026-10-13.

**While a module is being built, its version is 0.0.N**, where N is how many commits have changed the module's folder, the one that makes the version included. Merge commits aren't counted: they only repeat the work of the branch they bring in. So the number says how much work has gone into the module, and nothing it doesn't know. To see a module's count now:

```bash
git rev-list --count --no-merges main -- loggbok
```

**Once the owner declares a module's development map complete, it becomes 1.0.0** (Yggdrasil did on 2026-10-13). From then on, each change is classified by the owner when it is merged, and a new version raises the number for the largest kind among its changes:

| Kind      | Meaning                                         | Example       |
| --------- | ----------------------------------------------- | ------------- |
| **Major** | a big step: a new capability, a new way to work | 1.4.2 → 2.0.0 |
| **Minor** | an improvement                                  | 1.4.2 → 1.5.0 |
| **Fix**   | only bugs fixed                                 | 1.4.2 → 1.4.3 |

**The suite's version is 0.0.N** by the same count over the whole repository (`git rev-list --count --no-merges main`). It is raised with every module's release, and only the owner moves it past 0.0.

A changelog says **By hand:** before any step an upgrade needs besides the installer (a new backup procedure, a setting to change), so read it before deploying.

How changes become a version:

1. Work happens on a branch, as always. Its changes are added to the module's changelog under **Unreleased** (for a module at 1.0.0 or later, each starting with **Major:**, **Minor:** or **Fix:**), and it is merged into `main`.
2. Several merges can wait there. When the module is deployed, one commit turns **Unreleased** into the new version with the date, sets `package.json` to it, and does the same for the suite. That commit is tagged `<module>-v<version>` and `axis-suite-v<version>` (for example `yggdrasil-v1.1.0` and `axis-suite-v0.0.70`), and pushed with its tags.
3. The VPS pulls and installs as before. The installer prints the version it installed.

A tag marks the exact code of a version, so `git log yggdrasil-v1.0.0..yggdrasil-v1.1.0 -- yggdrasil` lists everything that changed in Yggdrasil between two versions. `packages/heimdall-client` has no version of its own: it is part of the modules that use it, and its changes are written in their changelogs.

## Sharing the server with certbot

If the server already renews a certificate with certbot in **standalone** mode (common for mail servers), that renewal fails once Caddy holds port 80. Switch it to webroot mode so Caddy serves the challenge files instead:

```bash
sudo mkdir -p /var/www/acme
sudo cp axis-suite/deploy/certbot-webroot.caddy /etc/caddy/sites.d/mail.caddy
sudo sed -i 's/mail.example.com/YOUR.MAIL.DOMAIN/' /etc/caddy/sites.d/mail.caddy
sudo systemctl reload caddy
sudo certbot reconfigure --cert-name YOUR.MAIL.DOMAIN --webroot -w /var/www/acme   # does a test run first
sudo certbot renew --dry-run
```

Make sure the service that uses the certificate reloads after a renewal. For Postfix, add a deploy hook: a file in `/etc/letsencrypt/renewal-hooks/deploy/` that runs `systemctl reload postfix`.

## Adding a module

1. Pick the next free ports and add a line to `deploy/modules.conf`. Add the folder to `pnpm-workspace.yaml`.
2. Create the folder with the layout above. Loggbok is the template for a module with an API and a frontend:
   - `package.json` with `dev`, `build`, `typecheck` and `start` scripts, `"files": ["dist"]`, and `"@axis-suite/heimdall-client": "workspace:*"` in `dependencies`. Shared tools (`typescript`, `@types/node`) use `"catalog:"`. Anything only the frontend uses goes in `devDependencies`, since the build bundles it.
   - `server/index.ts`: put `sameOriginWrites` and `requireUser` in front of `/api`, serve `GET /api/me` with `me`, answer `GET /healthz`, and keep data under `STATE_DIRECTORY`. Store users by `username`, and at startup delete the data of owners not in `knownUsers()` (see Loggbok's `removeUnknownOwners`).
   - `web/`: use `apiFetch`, `fetchMe` and `goToSignIn` from `@axis-suite/heimdall-client/browser`.
   - The About box: the module's logo and name at the top left are a button that opens it, with the module's version and the suite's it was built with. Copy `web/ui/About.tsx` from Papyrus (or `web/About.tsx` from Loggbok, for a module without a `Dialog`) and the `define` of `__AXIS_VERSIONS__` in its `vite.config.ts`.
   - Narrow windows (below Tailwind's `md`, 768px, e.g. a window snapped to half the screen): the sidebar becomes a slide-in drawer over a dimmed backdrop. A menu button opens it; the backdrop, an X, or picking something closes it. Copy the drawer from Loggbok or Papyrus.
   - `deploy/<module>.service` (copy Loggbok's, change the names) and `deploy/<module>.caddy`.
3. For local development, add its dev-server origin to `heimdall/dev.env` as `RETURN_ORIGIN_<MODULE>`.
4. Add it to the module table at the top of this file, start its `CHANGELOG.md` (copy Loggbok's header), then `pnpm install && pnpm check && pnpm build`.
5. Install it: `sudo bash deploy/install.sh <module>`. With a real domain, add its DNS record first.

## Runtime

The whole suite runs on **one Node.js version**, because a server has a single `/usr/bin/node`. It is set in [`deploy/node.sh`](deploy/node.sh) (currently 22, from NodeSource, which `node:sqlite` needs), along with `.node-version` and the `engines` fields. To move to a newer Node, change all three and re-run the installer for every module. pnpm's version is the `packageManager` field of the root `package.json`. Node 22 is supported until April 2027.

This repository is public, and so is `heimdall/server/users.ts` with every account's username and password hash.

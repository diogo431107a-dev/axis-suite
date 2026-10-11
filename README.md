# Axis Suite

Small self-hosted web apps ("modules") that share one sign-in. Everything runs on a single Debian 13 server behind Caddy.

| Module                         | What it is                                                                                               | Port | Local port |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| [Heimdall](heimdall/README.md) | The sign-in service. It holds the user accounts and sessions; the other modules ask it who is signed in. | 3000 | 443        |
| [Loggbok](loggbok/README.md)   | A notes manager. Each signed-in user sees only their own notes.                                          | 3001 | 8443       |

Shared code lives in `packages/`:

| Package                                                           | What it is                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [@axis-suite/heimdall-client](packages/heimdall-client/README.md) | How a module learns who is signed in (server middleware) and sends people to sign in (browser helpers). |

Every module is TypeScript on Node.js 22, built with pnpm, installed by the same installer and run the same way. The ports are registered in [`deploy/modules.conf`](deploy/modules.conf).

## How the modules connect

```
browser ──https──▶ Caddy ──▶ heimdall  127.0.0.1:3000   accounts, sessions, sign-in page
                        └──▶ loggbok   127.0.0.1:3001   notes API + static frontend
                                   │
                                   └── GET /whoami ──▶ heimdall (server to server, with the browser's cookie)
```

- **Shared cookie.** Heimdall sets the session cookie `heimdall_sid`. On a real domain it is scoped to the parent domain (`COOKIE_DOMAIN`), so browsers send it to every module's subdomain. On `localhost` or an IP address all modules share one host, so the cookie needs no domain.
- **Who is signed in.** Each module's API runs `requireUser` from `@axis-suite/heimdall-client/server`, which forwards the browser's cookie to Heimdall's `GET /whoami` on every request. Closing the session in Heimdall therefore signs the user out of every module at once. Each of those requests also counts as use: a session ends after 48 hours without any, and 14 days after sign-in at the latest.
- **Return after sign-in.** When nobody is signed in, the module's page sends the browser to Heimdall's `/?next=<page>`. Heimdall only sends users back to origins that were registered with it: the installer gives each module a systemd drop-in, `/etc/systemd/system/heimdall.service.d/origin-<module>.conf`, setting `RETURN_ORIGIN_<MODULE>`.
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
pnpm dev          # every module at once; open http://127.0.0.1:5173 for Loggbok
```

Use `127.0.0.1`, not `localhost`: browsers send Heimdall's cookie (`127.0.0.1:3000`) to Loggbok only on the same host. Demo accounts: `odin` / `allfather-demo`, `freya` / `folkvangr-demo`, `john` / `john-demo`. Local data goes in each module's `data/` folder, which git ignores.

```bash
pnpm check        # formatting, lint and type-check, as CI runs them
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
```

To update: `cd ~/axis-suite && git pull`, then re-run the installer for each module that changed.

> The installer owns `/etc/caddy/Caddyfile` and rewrites it on every run (an unrelated one is backed up first). Anything else Caddy should serve goes in its own file in `/etc/caddy/sites.d/`; those are kept.

### WSL test install

From inside WSL, as your normal user:

```bash
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh heimdall localhost
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/deploy/install.sh loggbok
```

Heimdall is then at https://localhost and Loggbok at https://localhost:8443. Caddy signs `localhost` with its own local CA, which Windows doesn't trust, so browsers warn until you import its root certificate into Windows' _Trusted Root Certification Authorities_. It is at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`; that folder is root-only, so copy the file out first, e.g. `sudo cp …/root.crt /mnt/c/Users/<you>/caddy-root.crt`.

## Operating it

```bash
systemctl status heimdall loggbok         # running?
journalctl -u loggbok -f                  # a module's log
sudo systemctl restart loggbok            # restart one module
cat /etc/axis-suite/suite.env             # the domain and URLs every module was given
```

Each module keeps its data in its own systemd `StateDirectory`, `/var/lib/<module>`, outside `/opt` and readable only by that module's service:

| Module   | Data               | Location                    |
| -------- | ------------------ | --------------------------- |
| Heimdall | sessions           | `/var/lib/heimdall/`        |
| Loggbok  | every user's notes | `/var/lib/loggbok/notes.db` |

Back up a module's data with its service stopped, and keep the copies where only you can read them:

```bash
sudo systemctl stop loggbok
sudo install -m 600 -o "$USER" /var/lib/loggbok/notes.db ~/notes-backup-$(date +%Y%m%d).db
sudo systemctl start loggbok
```

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
   - `server/index.ts`: put `sameOriginWrites` and `requireUser` in front of `/api`, serve `GET /api/me` with `me`, answer `GET /healthz`, and keep data under `STATE_DIRECTORY`. Store users by `username`.
   - `web/`: use `apiFetch`, `fetchMe` and `goToSignIn` from `@axis-suite/heimdall-client/browser`.
   - `deploy/<module>.service` (copy Loggbok's, change the names) and `deploy/<module>.caddy`.
3. For local development, add its dev-server origin to `heimdall/dev.env` as `RETURN_ORIGIN_<MODULE>`.
4. Add it to the module table at the top of this file, then `pnpm install && pnpm check && pnpm build`.
5. Install it: `sudo bash deploy/install.sh <module>`. With a real domain, add its DNS record first.

## Runtime

The whole suite runs on **one Node.js version**, because a server has a single `/usr/bin/node`. It is set in [`deploy/node.sh`](deploy/node.sh) (currently 22, from NodeSource, which `node:sqlite` needs), along with `.node-version` and the `engines` fields. To move to a newer Node, change all three and re-run the installer for every module. pnpm's version is the `packageManager` field of the root `package.json`. Node 22 is supported until April 2027.

This repository is public, and so is `heimdall/server/users.ts` with every account's username and password hash.

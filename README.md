# Axis Suite

Small self-hosted web apps that share one sign-in. Everything runs on a single Debian 13 server behind Caddy.

| App | What it is | Stack |
|-----|------------|-------|
| [Heimdall](heimdall/README.md) | The sign-in service. It holds the user accounts and sessions, and the other apps ask it who is logged in. | TypeScript, Node 20+, npm |
| [Loggbok](loggbok/README.md) | A notes manager. Each signed-in user sees only their own notes. | React + Express + SQLite, Node 22+, pnpm |

Each app is self-contained in its own folder, with its own package file, lockfile and installer. They are kept in one repository because they only work together and must be changed together.

## How they connect

```
browser ──https──▶ Caddy ──▶ Heimdall  127.0.0.1:3000   accounts, sessions, login page
                        └──▶ Loggbok   127.0.0.1:3001   notes API + static frontend
                                   │
                                   └── GET /whoami ──▶ Heimdall (server to server, with the browser's cookie)
```

- **Shared cookie.** Heimdall sets the session cookie `heimdall_sid`. With `COOKIE_DOMAIN=gansoazul.com.br`, browsers send it to every subdomain, so Loggbok receives it too.
- **Who is signed in.** Loggbok forwards that cookie to Heimdall's `GET /whoami` on every API request. Closing the session in Heimdall therefore signs the user out of Loggbok at once.
- **Return after login.** When nobody is signed in, Loggbok sends the browser to Heimdall's `/?next=<page>`. Heimdall only sends users back to addresses listed in its `RETURN_ORIGINS`.
- **Keep them in step.** A change to `/whoami`, the cookie, or these two settings has to be made on both sides in the same commit.

## Runtime

The whole suite runs on **one Node.js version**, because a server has a single `/usr/bin/node` and every app's service uses it. The version is set once, in [`deploy/node.sh`](deploy/node.sh) (currently 22, from NodeSource). Each app's installer sources that file and installs or keeps that version. Debian's own `nodejs`/`npm` packages aren't used: they conflict with NodeSource's.

To move the suite to a newer Node, change `AXIS_NODE_MAJOR` in `deploy/node.sh`, `.node-version`, and the `engines` field in each app's `package.json`. Then re-run the installers.

## Installing

Install them in this order:

1. **Heimdall.** It brings in Caddy and HTTPS. Follow [heimdall/README.md](heimdall/README.md), but first set `COOKIE_DOMAIN` and `RETURN_ORIGINS` in `heimdall/deploy/heimdall.service`.
2. **Loggbok.** It adds a Caddy site file under `/etc/caddy/sites.d/` and needs Node 22. See [loggbok/README.md](loggbok/README.md).

### WSL test install

Run these inside WSL as your normal user. Both are safe to re-run after every change:

```bash
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/heimdall/deploy/install.sh localhost
```

```bash
sudo bash /mnt/c/Users/diogo/Claude/axis-suite/loggbok/deploy/install-wsl.sh
```

Use `sudo` from your own user, not a root shell. Loggbok's installer builds the app as the user who ran `sudo`.

Heimdall is then at https://localhost and Loggbok at https://localhost:8443.

## Repository layout

```
deploy/     shared by the installers (node.sh: the suite's Node.js version)
heimdall/   sign-in service (see its README)
loggbok/    notes app (see its README)
```

This repository is private. `heimdall/src/users.ts` holds the account list and password hashes, so keep it private.

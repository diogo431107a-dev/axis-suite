# Loggbok

A persistent notes manager. React + Vite frontend, Express backend, SQLite via the `node:sqlite` built-in (Node.js 22+). No native compilation required.

Loggbok has no login of its own. It uses the sessions of [Heimdall](../heimdall): whoever is signed in to Heimdall sees their own notes, and nobody else's.

## Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Frontend  | React 19, Vite 8, Tailwind CSS 4    |
| Backend   | Express 5, Node.js built-in sqlite  |
| Database  | SQLite: `/var/lib/loggbok/notes.db` on a server, `server/notes.db` in dev |
| Sign-in   | Heimdall sessions                   |
| Package   | pnpm 11                             |

```
server/
  index.js    API routes
  auth.js     asks Heimdall who is signed in; refuses cross-origin writes
  access.js   who may see / change which note (the only place notes are queried)
  db.js       SQLite schema and migrations (PRAGMA user_version)
src/
  App.tsx     the whole UI
deploy/
  loggbok.caddy   Caddy site, goes in /etc/caddy/sites.d/
```

## How sign-in works

1. Every `/api` request goes through `requireUser` (`server/auth.js`). It forwards the browser's `Cookie` header to Heimdall's `GET /whoami` and gets back `{ username, name }`. Closing a session in Heimdall therefore signs the user out of Loggbok immediately.
2. If nobody is signed in, the API answers `401 { loginUrl }`. The app then sends the browser to `<loginUrl>/?next=<this page>`, and Heimdall sends it back after sign-in.
3. If the session ends while someone is writing, a banner asks them to sign in again in a new tab. The draft stays. If a *different* user signs in, the page reloads with that user's notes.

For this to work, the browser must send Heimdall's cookie to Loggbok, and Heimdall must accept Loggbok as a return address:

| Where                     | Setting                                                              |
|---------------------------|----------------------------------------------------------------------|
| Heimdall                  | `COOKIE_DOMAIN=gansoazul.com.br` (the parent of both subdomains)     |
| Heimdall                  | `RETURN_ORIGINS=https://loggbok.gansoazul.com.br`                    |
| Loggbok API               | `HEIMDALL_INTERNAL_URL=http://127.0.0.1:3000` (server-to-server)     |
| Loggbok API               | `HEIMDALL_PUBLIC_URL=https://heimdall.gansoazul.com.br` (browser)    |

Notes belong to a Heimdall **username**. Renaming a user in Heimdall's `users.ts` leaves their old notes behind under the old name. Changing only the display name is fine.

## Local development

Requires **Node.js 22+** and **pnpm**, plus Heimdall running locally.

1. Start Heimdall and allow it to send you back to Loggbok. From `../heimdall`, in PowerShell:

   ```powershell
   $env:RETURN_ORIGINS='http://127.0.0.1:5173'; npm run dev
   ```

2. Start Loggbok:

   ```bash
   pnpm install
   pnpm dev          # starts frontend (127.0.0.1:5173) and API (127.0.0.1:3001) together
   ```

3. Open **http://127.0.0.1:5173**. Use `127.0.0.1`, not `localhost`. Cookies are shared between ports of the same host, so the Heimdall cookie from `127.0.0.1:3000` reaches Loggbok only on `127.0.0.1`. Demo accounts: `freya` / `folkvangr-demo`, `john` / `john-demo`, `odin` / `allfather-demo`.

If Heimdall runs elsewhere, set `HEIMDALL_INTERNAL_URL` and `HEIMDALL_PUBLIC_URL` for the API (both default to `http://127.0.0.1:3000`).

The SQLite database is created automatically at `server/notes.db` on first run. If `STATE_DIRECTORY` is set, it lives there instead. systemd sets it on a server (see step 5 below), and the log's first line names the file in use. A database from before user accounts existed has its notes discarded on the first start (the log says how many).

Individual servers:

```bash
pnpm dev:client   # Vite only
pnpm dev:server   # Express only
```

Production build:

```bash
pnpm build        # type-check + bundle → dist/
```

## API

Every endpoint requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Loggbok's own origin (`403` otherwise).

| Method | Path            | Description                                        |
|--------|-----------------|----------------------------------------------------|
| GET    | /api/me         | The signed-in user: `{ username, name, accountUrl }` |
| GET    | /api/notes      | List the notes you can see                         |
| GET    | /api/notes?q=   | Search them (title+body)                           |
| POST   | /api/notes      | Create a note: `{ title, content }`                |
| PUT    | /api/notes/:id  | Update a note: `{ title, content }`                |
| DELETE | /api/notes/:id  | Delete a note                                      |

The server assigns note ids and timestamps. Each note comes back with `owner` (a Heimdall username) and `role` (your access to it, currently always `owner`). A note you can't see answers `404`, the same as one that doesn't exist.

---

## Deployment — WSL2 (Debian 13), next to Heimdall

A rehearsal of the VPS setup on your own machine. It assumes Heimdall is already installed in WSL with `sudo bash deploy/install.sh localhost`, so it is served at `https://localhost`. From inside WSL:

```bash
sudo bash /mnt/c/Users/<you>/Claude/axis-suite/loggbok/deploy/install-wsl.sh
```

The script is safe to re-run after every change on the Windows side. It does the VPS steps below with WSL values:
- installs Node 22 and pnpm if they're missing
- copies the project to `~/loggbok` and builds it as your user
- installs the `loggbok` service, with the notes in `/var/lib/loggbok/` (moving them there once from `~/loggbok/server/notes.db` if an older install left them there)
- serves the app at **https://localhost:8443** through Caddy

Both apps live on the host `localhost`, and cookies ignore ports, so Heimdall's ordinary cookie reaches Loggbok without `COOKIE_DOMAIN`. The script adds a systemd drop-in to Heimdall, `/etc/systemd/system/heimdall.service.d/loggbok-wsl.conf`. It clears `COOKIE_DOMAIN` and sets `RETURN_ORIGINS=https://localhost:8443`, and it survives Heimdall reinstalls.

Caddy signs `localhost` with its own local CA, which Windows doesn't trust, so browsers warn on both `https://localhost` and `https://localhost:8443`. You can click through the warning. To stop the warnings, import Caddy's root certificate into Windows' *Trusted Root Certification Authorities*. It is at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` in WSL. That folder is root-only, so copy the file out first, e.g. `sudo cp …/root.crt /mnt/c/Users/<you>/caddy-root.crt`.

---

## Deployment — VPS (Debian 13), next to Heimdall

Heimdall's installer puts Caddy on ports 80/443 and handles HTTPS. Loggbok is added as one more Caddy site, so nginx and certbot are not needed. Install Heimdall first (see its README) and set `COOKIE_DOMAIN` and `RETURN_ORIGINS` in `deploy/heimdall.service` before running its installer.

SSH into your VPS as a non-root user with `sudo` access before starting.

### 1. DNS

Point `loggbok.gansoazul.com.br` at the VPS with an A record, the same way as Heimdall's domain. Caddy gets the certificate automatically.

### 2. Install pnpm

Node.js is already there: Heimdall's installer sets up the version shared by the whole suite (`axis-suite/deploy/node.sh`, currently 22 from NodeSource), which is what `node:sqlite` needs. Only pnpm is missing:

```bash
node --version    # v22.x
sudo npm install -g pnpm@11
```

### 3. Copy the project to the VPS

From your **local machine**:

```bash
scp -r ~/loggbok user@<vps-ip>:~/loggbok
```

Replace `user` with your VPS username and `<vps-ip>` with the server's IP address or hostname. Alternatively, push to a git remote and clone it on the VPS.

### 4. Install dependencies and build

```bash
cd ~/loggbok
pnpm install
pnpm build        # produces dist/
```

### 5. Create a systemd service for the API

This keeps the Express server running in the background and restarts it on failure or reboot.

```bash
sudo tee /etc/systemd/system/loggbok.service > /dev/null <<'EOF'
[Unit]
Description=Loggbok API
After=network.target heimdall.service

[Service]
User=diroadm
WorkingDirectory=/home/diroadm/axis-suite/loggbok
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=HEIMDALL_INTERNAL_URL=http://127.0.0.1:3000
Environment=HEIMDALL_PUBLIC_URL=https://heimdall.gansoazul.com.br
StandardOutput=journal
StandardError=journal
# Notes live in /var/lib/loggbok (passed to the app as STATE_DIRECTORY), readable only by User=.
StateDirectory=loggbok
StateDirectoryMode=0700
UMask=0077

# Hardening: the state directory is the only place the service can write.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now loggbok
sudo systemctl status loggbok
```

If your user or checkout path differs, change `User=` and `WorkingDirectory=`. Check that status shows `active (running)` before continuing. `journalctl -u loggbok` should start with `Notes database: /var/lib/loggbok/notes.db`.

The notes are kept outside the checkout on purpose:
- Caddy needs your home directory to be `o+x`, so anything in the checkout is readable by every other account on the server.
- `git clean` or a fresh clone would delete everyone's notes along with it.

#### Moving the database from an older install

Older installs kept the notes in `server/notes.db` inside the checkout. Loggbok refuses to start while that file is there and `/var/lib/loggbok/notes.db` isn't, so it can't quietly start with no notes. The log then shows the commands to move it. With the unit above in place, move it once:

```bash
sudo systemctl stop loggbok
sudo install -d -o diroadm -g diroadm -m 700 /var/lib/loggbok
sudo mv /home/diroadm/axis-suite/loggbok/server/notes.db* /var/lib/loggbok/
sudo chown diroadm:diroadm /var/lib/loggbok/notes.db* && sudo chmod 600 /var/lib/loggbok/notes.db*
sudo systemctl start loggbok
journalctl -u loggbok -n 5 --no-pager   # "Notes database: /var/lib/loggbok/notes.db", and no warning
```

### 6. Add the Caddy site

Caddy serves two things from `loggbok.gansoazul.com.br`:
- **Static files** (`/`): the built React app from `dist/`
- **API requests** (`/api/`): proxied to the Express server on port 3001

Run this from the `loggbok` folder of your checkout. It writes the site file with that checkout's real `dist/` path instead of the template's placeholder (`/home/diogo/loggbok/dist`):

```bash
cd ~/axis-suite/loggbok
sed "s#/home/diogo/loggbok/dist#$PWD/dist#" deploy/loggbok.caddy | sudo tee /etc/caddy/sites.d/loggbok.caddy > /dev/null
grep root /etc/caddy/sites.d/loggbok.caddy    # must show your checkout's dist/
```

If your domain isn't `loggbok.gansoazul.com.br`, also change the site address in that file.

Caddy runs as the `caddy` user. It needs execute permission on **every** directory down to `dist/`, and read permission on the files. Debian 13 creates home directories as `700`, so open yours for traversal only:

```bash
chmod o+x ~
namei -l "$PWD/dist/index.html"    # every directory needs x for "other", index.html needs r
```

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

Open `https://loggbok.gansoazul.com.br`. You are sent to Heimdall to sign in, then back to your notes.

**Blank `403 Forbidden` on the page while `/api/me` answers?** Caddy can't read the files at the site's `root`. Usually the path is wrong (e.g. still the placeholder, which may point into another user's private home), or a directory on the way lacks `o+x`. Check with `grep root /etc/caddy/sites.d/loggbok.caddy` and `namei -l <that path>/index.html`.

If the server was previously set up with nginx for Loggbok, stop it first (`sudo systemctl disable --now nginx`), because Caddy needs ports 80 and 443.

---

## Database backup

All users' notes are in one file, `/var/lib/loggbok/notes.db`. It holds everyone's private notes, so keep backups where only you can read them. Stop the service while copying so the file is consistent:

```bash
sudo systemctl stop loggbok
sudo install -m 600 -o "$USER" /var/lib/loggbok/notes.db ~/notes-backup-$(date +%Y%m%d).db
sudo systemctl start loggbok
```

---

## After unzipping this archive

```bash
pnpm install    # restores node_modules
pnpm build      # rebuilds dist/ for production
# or:
pnpm dev        # run locally without building
```

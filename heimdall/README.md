# Heimdall

A minimal web login gate. Users sign in with hardcoded credentials. After a successful login they see the current time and their name, and can close the session to sign in as someone else. Three wrong attempts lock that client out for 5 minutes.

- **Stack:** TypeScript on Node's built-in `http` module, with no runtime dependencies. In production, Caddy sits in front and handles HTTPS.
- **Security:** passwords are stored as scrypt hashes, never in plain text. The session cookie is HttpOnly and SameSite. A strict nonce-based Content-Security-Policy is applied. Response timing is the same for known and unknown usernames, so it doesn't reveal which accounts exist. Parallel guesses can't get past the attempt limit.

```
src/
  server.ts         HTTP routes: GET /, POST /login, POST /logout, GET /whoami
  users.ts          ← the hardcoded accounts live here
  state.ts          14-day sessions (saved to disk) + 3-strikes / 5-minute lockout
  views.ts          HTML pages (login, dashboard)
  password.ts       scrypt hashing
  hash-password.ts  CLI to create a hash for a new password
deploy/
  install.sh        one-shot installer for Debian 13
  heimdall.service  systemd unit (sandboxed)
```

## Run locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000. The demo accounts are `odin` / `allfather-demo`, `freya` / `folkvangr-demo` and `john` / `john-demo`.

## Set your own users (do this before deploying)

1. Generate a hash for each password. It prompts twice and doesn't echo what you type:

   ```bash
   npm run hash-password
   ```

2. Edit `src/users.ts`. Replace the demo entries with your own `{ username, name, passwordHash }` objects.

## Changing credentials

Credentials are part of the code, so a change means a redeploy:

1. Run `npm run hash-password` and enter the new password.
2. In `src/users.ts`, replace that user's `passwordHash` with the new hash. Add or remove users the same way.
3. Upload and run the installer again (steps 3 and 4 below).

After the redeploy, **that user is asked to log in again on every device**. Everyone else stays logged in. Removing or renaming a user ends their sessions the same way. Changing only the display `name` does not. Nobody is locked out by the change, and the service restart clears any lockouts in progress.

Generating a new hash for the *same* password also counts as a change. Use this to sign one user out everywhere, for example after they lose a device.

## Deploy to the Debian 13 VPS

**1. DNS (recommended).** Point a domain such as `heimdall.example.com` at the VPS with an A record. Caddy then gets a free Let's Encrypt certificate automatically. If you only have the IP, the installer falls back to a self-signed certificate, and browsers will show a warning you have to click through.

**2. Firewall.** Ports 80 and 443 must be reachable. If the server already has a firewall, add 80/443 to it rather than installing a new one. A new firewall that only allows SSH and web traffic blocks everything else the server does, mail included. If you do use `ufw`, allow every service *before* enabling it:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp
# Mail server on the same box? Also allow its ports, e.g.:
sudo ufw allow 25,465,587,993,995,143,110/tcp
sudo ufw status verbose   # check the list, then:
sudo ufw enable
```

**3. Copy the project up from Windows (PowerShell).** Run this from the folder that *contains* `heimdall`:

```powershell
tar --exclude=node_modules --exclude=dist --exclude=data -czf heimdall.tgz heimdall
scp heimdall.tgz youruser@your-vps:~
```

**4. On the VPS, unpack and install:**

```bash
tar -xzf heimdall.tgz
cd heimdall
sudo bash deploy/install.sh heimdall.example.com
```

The installer pulls `nodejs`, `npm`, `caddy`, `rsync` and `curl` from Debian's repos. It builds the app into `/opt/heimdall`, starts the `heimdall` systemd service on `127.0.0.1:3000`, and configures Caddy to serve it over HTTPS. To update the app, repeat steps 3 and 4. The installer is safe to re-run.

> The installer replaces `/etc/caddy/Caddyfile` (it backs up the old one first). If the VPS already hosts other sites through Caddy, merge the `heimdall` block by hand instead.

## Sharing the server with certbot

The installer rewrites `/etc/caddy/Caddyfile` on every run. It also loads every `/etc/caddy/sites.d/*.caddy` file, and those files are kept across runs.

If the server already renews a certificate with certbot in **standalone** mode, that renewal will fail once Caddy holds port 80. This is common for mail servers. Switch it to webroot mode so Caddy serves the challenge files instead:

```bash
sudo mkdir -p /var/www/acme
sudo cp deploy/certbot-webroot.caddy /etc/caddy/sites.d/mail.caddy
sudo sed -i 's/mail.example.com/YOUR.MAIL.DOMAIN/' /etc/caddy/sites.d/mail.caddy
sudo systemctl reload caddy
sudo certbot reconfigure --cert-name mail.gansoazul.com.br --webroot -w /var/www/acme   # does a test run first
sudo certbot renew --dry-run
```

Make sure the service that uses the certificate reloads after a renewal. For Postfix, add a deploy hook: a file in `/etc/letsencrypt/renewal-hooks/deploy/` that runs `systemctl reload postfix`.

## Operating it

```bash
systemctl status heimdall          # is it running?
journalctl -u heimdall -f          # logins, logouts, lockouts
sudo systemctl restart heimdall    # keeps sessions, clears lockouts
sudo rm /var/lib/private/heimdall/sessions.json && sudo systemctl restart heimdall   # sign everyone out
```

## Behaviour notes

- **Lockout is per client IP.** It is not per username, so an attacker can't lock a real user out of their account. Three failures in a row lock that IP for 5 minutes. During the lockout, even the correct password is refused. A countdown on the page re-enables the form when the lockout ends.
- **One user per browser.** While a browser is signed in, any new login from it is refused until **Close session** is clicked. A "Close session" button left open in an old tab never logs out a different user. Separate browsers, browser profiles and private windows keep their own cookies, so they count as separate devices. No website can tell they are on the same computer.
- **One account can be logged in on several devices at once.** Each login gets its own session, and **Close session** only ends the session on the device where it was clicked.
- **Sessions last 14 days** from login, whether the user is active or not. They end early when the user clicks **Close session**, or when that user's credentials change (see *Changing credentials*). The dashboard shows when the next re-login is due.
- **Sessions survive restarts and reboots.** They are saved to `/var/lib/heimdall/sessions.json`, which holds only hashes of the session tokens, never the cookie values themselves. When running locally they go in `./data/`. Lockouts stay in memory, so a restart clears them.
- **Configuration** comes from environment variables in `deploy/heimdall.service`: `HOST`, `PORT`, `TRUST_PROXY=1` (trust Caddy's `X-Forwarded-For`), `COOKIE_SECURE=1` (cookie is only sent over HTTPS), and the two below for sibling apps.

## Signing in to other apps (Loggbok)

Other apps on the same VPS can reuse Heimdall's sessions instead of having their own logins. [Loggbok](../loggbok) does this.

- **`GET /whoami`** returns `200 {"username","name","expiresAt"}` for the session in the request's `heimdall_sid` cookie, or `401`. The app's server forwards the browser's `Cookie` header to `http://127.0.0.1:3000/whoami` on every request. Closing a session in Heimdall therefore signs the user out of the app immediately.
- **`COOKIE_DOMAIN=gansoazul.com.br`** scopes the session cookie to the parent domain, so `loggbok.gansoazul.com.br` receives it as well as `heimdall.gansoazul.com.br`. Trade-off: the browser now sends the cookie to *every* subdomain (mail included). It stays HttpOnly, Secure and SameSite=Lax, so page scripts on those sites can't read it, but any server on a subdomain could. Leave it unset if Heimdall is the only app.
- **`RETURN_ORIGINS=https://loggbok.gansoazul.com.br`** (comma-separated) lists the apps that may send users to `/?next=<url>`. After signing in, or right away if they already are, the user goes back to that URL. A `next` from any other origin is ignored, so this can't be used as an open redirect.

Sessions opened before `COOKIE_DOMAIN` was set use a cookie that only the Heimdall host receives. The first time an app sends that user to `/?next=`, Heimdall moves the session onto the shared domain, without asking them to sign in again.

# Heimdall

The suite's sign-in service. Users sign in with hardcoded credentials. After signing in they see the current time and their name, and can close the session to sign in as someone else. Three wrong attempts lock that client out for 5 minutes. The other modules ask Heimdall who is signed in, so they need no login of their own.

- **Stack:** TypeScript on Node's built-in `http` module, with no runtime dependencies. Caddy sits in front and handles HTTPS.
- **Security:** passwords are stored as scrypt hashes, never in plain text. The session cookie is HttpOnly and SameSite. A strict nonce-based Content-Security-Policy is applied. Response timing is the same for known and unknown usernames, so it doesn't reveal which accounts exist. Parallel guesses can't get past the attempt limit.

```
server/
  index.ts          HTTP routes: GET /, POST /login, POST /logout, GET /whoami, GET /online, GET /healthz
  users.ts          ← the hardcoded accounts live here
  state.ts          sessions (48 h idle / 14 days, saved to disk) + 3-strikes / 5-minute lockout
  views.ts          HTML pages (login, dashboard)
  password.ts       scrypt hashing
  hash-password.ts  CLI to create a hash for a new password
  list-users.ts     prints every username, for the installer (modules delete everyone else's data)
deploy/
  heimdall.service  systemd unit (sandboxed)
  heimdall.caddy    Caddy site
dev.env             settings for local development
```

## Run locally

From the suite's root, `pnpm dev` starts Heimdall with every other module. For Heimdall alone:

```bash
pnpm --filter heimdall dev
```

Open http://127.0.0.1:3000. The demo accounts are `odin` / `allfather-demo`, `freya` / `folkvangr-demo` and `john` / `john-demo`. Sessions are saved in `./data/`.

## Users and passwords

The accounts are part of the code, in `server/users.ts`, so replace the demo ones before relying on the suite. To add, remove or change a user:

1. Generate a hash for the password. It prompts twice and doesn't echo what you type:

   ```bash
   pnpm --filter heimdall hash-password
   ```

2. Edit `server/users.ts`: each user is a `{ username, name, passwordHash }` object.
3. Commit and push, then on the server: `cd ~/axis-suite && git pull && sudo bash deploy/install.sh heimdall`.

After the redeploy, **that user is asked to log in again on every device**. Everyone else stays logged in. Removing or renaming a user ends their sessions the same way. Changing only the display `name` does not. Nobody is locked out by the change, and the service restart clears any lockouts in progress.

Generating a new hash for the _same_ password also counts as a change. Use this to sign one user out everywhere, for example after they lose a device.

Modules store their data under the **username**. **Removing a user deletes their data in every module** (notes, outlines, vaults) on the next deploy. The installer gives the modules the new list of usernames, and each module deletes the data of anyone not on it when it restarts. There is no undo apart from a backup. **Renaming a user is a removal too:** the old name's data is deleted, and the new name starts empty. To keep the data in Loggbok and Yggdrasil, do the steps in this order:

1. Stop the module.
2. Deploy Heimdall. A stopped module isn't restarted.
3. Change the `owner` column in the module's database to the new name.
4. Start the module.

Janus can't be moved that way. Export the vault before the rename and import it under the new name afterwards.

## Operating it

```bash
journalctl -u heimdall -f          # logins, logouts, lockouts
sudo systemctl restart heimdall    # keeps sessions, clears lockouts
sudo rm /var/lib/private/heimdall/sessions.json && sudo systemctl restart heimdall   # sign everyone out
```

## Behaviour notes

- **Lockout is per client IP.** It is not per username, so an attacker can't lock a real user out of their account. Three failures in a row lock that IP for 5 minutes. During the lockout, even the correct password is refused. A countdown on the page re-enables the form when the lockout ends.
- **One user per browser.** While a browser is signed in, any new login from it is refused until **Close session** is clicked. A "Close session" button left open in an old tab never logs out a different user. Separate browsers, browser profiles and private windows keep their own cookies, so they count as separate devices. No website can tell they are on the same computer.
- **One account can be logged in on several devices at once.** Each login gets its own session, and **Close session** only ends the session on the device where it was clicked.
- **Sessions end after 48 hours unused, and 14 days after login at the latest.** Using any module, or opening Heimdall's page, restarts the 48 hours, so someone who uses the suite daily signs in about twice a month. A session forgotten on a shared or public computer ends two days after its last use. Clicking **Close session** still ends it at once, and is the right thing to do there. A credentials change also ends it (see _Users and passwords_). The dashboard shows both times.
- **Sessions survive restarts and reboots.** They are saved to `/var/lib/heimdall/sessions.json`, which holds only hashes of the session tokens, never the cookie values themselves. Lockouts stay in memory, so a restart clears them.

## Configuration

Environment variables. On a server, `deploy/install.sh` writes them to `/etc/axis-suite/` and the unit file reads them from there.

| Variable                 | Meaning                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `HOST`, `PORT`           | Where to listen. Default `127.0.0.1:3000`.                                                                   |
| `STATE_DIRECTORY`        | Where sessions are saved. Set by systemd; default `./data`.                                                  |
| `TRUST_PROXY=1`          | Trust Caddy's `X-Forwarded-For` for the client IP.                                                           |
| `COOKIE_SECURE=1`        | Only send the cookie over HTTPS.                                                                             |
| `COOKIE_DOMAIN`          | Scope the cookie to this parent domain so every module's subdomain receives it. Empty: this host only.       |
| `RETURN_ORIGIN_<MODULE>` | An origin that may send users here with `?next=` and get them back. One per module; the installer adds them. |

## The contract with other modules

Modules use [`@axis-suite/heimdall-client`](../packages/heimdall-client/README.md) rather than talking to these endpoints themselves. Change the two together.

- **`GET /whoami`** returns `200 {"username","name","expiresAt"}` for the session in the request's `heimdall_sid` cookie, or `401`. A module's server forwards the browser's `Cookie` header here on every request, so closing a session in Heimdall signs the user out of every module immediately. Each call counts as use and restarts the session's 48-hour idle clock. `expiresAt` is when the session ends unless it is used again.
- **`GET /online`** returns `200 {"usernames":[…]}`, every user with at least one session that hasn't ended, or `401` if the request's own cookie has no live session. Only Althing uses it, for its "online" list, asking every 15 seconds with the cookie of someone who has Althing open. It does not count as use, so it never keeps a session open.
- **`COOKIE_DOMAIN`** makes `loggbok.example.com` receive the cookie as well as `heimdall.example.com`. Trade-off: the browser now sends it to _every_ subdomain (mail included). It stays HttpOnly, Secure and SameSite=Lax, so page scripts on those sites can't read it, but any server on a subdomain could.
- **`/?next=<url>`**: after signing in, or right away if they already are, the user goes back to that URL if its origin is registered. A `next` from any other origin is ignored, so this can't be used as an open redirect.

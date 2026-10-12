# Janus

A password manager in the style of KeePass: a tree of groups, entries with a username, password, URL and notes, a recycle bin, and TOTP codes for two-factor sign-in. Each signed-in user has one vault. Janus has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own vault and nobody else's.

| Layer    | Technology                                                                   |
| -------- | ---------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4, jsQR (QR codes)                            |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`, AES-256-GCM at rest |
| Database | `/var/lib/janus/janus.db` on a server, `data/janus.db` in development        |
| Key      | `/etc/axis-suite/janus.key` on a server, `data/janus.key` in development     |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                              |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
  totp.ts            TOTP codes (RFC 6238), otpauth:// links, base32; used by both sides
server/
  index.ts           routes, /healthz, removed users' vaults, recycle-bin purge, graceful shutdown
  keys.ts            loads the encryption key
  seal.ts            encrypts and decrypts what is stored
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  vault.ts           the only place vaults are read and written
web/
  vault/             groups, the entry list, an entry, the editor, export and import
  totp/              codes on screen, the TOTP setup dialog, reading QR codes
  generator/         passwords and passphrases (with the EFF's word list)
deploy/
  janus.service      systemd unit (sandboxed, with the key as a credential)
  janus.caddy        Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Encryption.** Everything people type (titles, usernames, passwords, URLs, notes, group names and TOTP secrets) is stored encrypted with AES-256-GCM under one key. Only ids, owners, links between rows and times are plain. Each value is bound to its user and row, so a value copied to another row, or another user's row, can't be opened there. The key is kept outside the database: on a server, systemd hands `/etc/axis-suite/janus.key` to the service as a credential that only the service can read.

**What that protects, and what it doesn't.** A copy of `janus.db` alone, such as a stolen backup, reveals nothing. But the server holds the key, so it can read every vault:

- Anyone with root on the server can read the key, and with it every password.
- Anyone who has a Heimdall session (or a Heimdall password) can open that user's vault. There is no separate master password.
- **Losing the key loses every vault.** Back it up once, apart from the server (see below).

**The page never holds more than it needs.** The vault list has no passwords, notes or TOTP secrets. An entry's password and notes are fetched when it is opened. TOTP codes are made on the server, so after setup a secret only leaves it when you ask for the setup link explicitly ("Show setup link", to move a TOTP to another app). The page stops asking for codes while its tab is hidden, so a forgotten tab doesn't keep the Heimdall session alive.

**Saving.** Each entry has a revision number. If an entry changed in another tab or on another device after you started editing it, saving says so. You can then save your changes over it (only the fields you changed replace the others) or discard yours.

**Deleting.** Entries go to the recycle bin first, and are deleted for good after 30 days (at start-up and daily) or when deleted from the bin. Only an empty group can be deleted.

**Signing out.** If the session ends while someone is editing, a banner asks them to sign in again in a new tab; the changes wait. If a different user signs in (in another tab), the page starts over with that user's vault: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Using it

**TOTP.** In an entry's editor, "Set up TOTP" takes the code setup from a site in any of these forms:

- its `otpauth://` link, or the secret key it shows (base32, like `JBSW Y3DP EHPK 3PXP`);
- a screenshot of its QR code, pasted with Ctrl+V;
- an image file of the QR code;
- the QR code itself, scanned with the camera.

The dialog shows the current code before you save, so you can check it against the site. SHA-1, SHA-256 and SHA-512, 6 to 8 digits and any period are supported. HOTP (counter-based) codes, Steam codes and Google Authenticator's export QR codes are not.

**Generator.** Random passwords (8–64 characters from a–z, A–Z, 0–9 and symbols, optionally without look-alike characters) or passphrases of 3–10 words from the [EFF's long word list](https://www.eff.org/dice) (CC BY 3.0 US, Electronic Frontier Foundation), with the number of bits of randomness shown. It is in the sidebar, and in the editor next to the password.

**Copying** a password, a code or a setup link clears it from the clipboard again after 30 seconds if Janus has the focus then, or else when you come back to Janus. Copying a username or URL doesn't.

| Keys                      | Action                                           |
| ------------------------- | ------------------------------------------------ |
| / or Ctrl+F               | Search all entries (title, username, URL, group) |
| ↑ / ↓                     | Previous / next entry (from the search box too)  |
| N                         | New entry (in the group shown)                   |
| E or Enter                | Edit the entry                                   |
| Ctrl+S / Esc              | Save / cancel, in the editor                     |
| Ctrl+B                    | Copy the username                                |
| Ctrl+C (nothing selected) | Copy the password                                |
| T                         | Copy the TOTP code                               |
| Ctrl+U                    | Open the URL                                     |
| Delete                    | Move the entry to the recycle bin                |

KeePass uses Ctrl+N, Ctrl+E and Ctrl+T, but browsers keep those for their own windows and tabs, so Janus uses N, E and T.

**Export and import** (sidebar) writes the whole vault, recycle bin excluded, to a JSON file and reads it back. **The file is not encrypted:** it holds every password and TOTP secret in plain text. An import adds to the vault: groups with the same path of names are filled rather than made twice, and an entry identical to one already in its group is skipped, so importing the same file twice adds nothing.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5175** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter janus dev` starts only Janus: the frontend on 127.0.0.1:5175 and the API on 127.0.0.1:3003. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter janus test    # the server and browser tests (Vitest)
```

On first run Janus makes `data/janus.key` and `data/janus.db`. Both are ignored by git. Deleting the key makes the database unreadable: delete both to start over.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Janus's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                      | Description                                                                                                    |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me                   | The signed-in user: `{ username, name, accountUrl }`                                                           |
| GET    | /api/vault                | `{ groups, entries }`: every group, and every entry without its password, notes or TOTP (recycle bin included) |
| POST   | /api/groups               | `{ name, parentId }` → the new group                                                                           |
| PATCH  | /api/groups/:id           | `{ name?, parentId? }`: rename or move (never inside itself)                                                   |
| DELETE | /api/groups/:id           | Delete an empty group (`409 not-empty` otherwise)                                                              |
| POST   | /api/entries              | `{ groupId, title, username, password, url, notes, totp? }` → the new entry                                    |
| GET    | /api/entries/:id          | The whole entry: password, notes, and the TOTP's settings (not its secret)                                     |
| PATCH  | /api/entries/:id          | The fields that change, with `rev` (`409 conflict` if the entry changed since); `totp: null` removes the TOTP  |
| DELETE | /api/entries/:id          | Move to the recycle bin; with `?purge=1`, delete from the bin for good                                         |
| POST   | /api/entries/:id/restore  | Take out of the recycle bin                                                                                    |
| GET    | /api/entries/:id/totp     | `{ code, period, remaining }`: the current code                                                                |
| GET    | /api/entries/:id/totp/uri | `{ uri }`: the TOTP as an `otpauth://` link, secret included                                                   |
| GET    | /api/export               | The vault as an export file (plain text)                                                                       |
| POST   | /api/import               | An export file → `{ groups, entries, skipped }`                                                                |
| GET    | /healthz                  | `ok` while the service runs (not served through Caddy)                                                         |

`totp` in a request is an `otpauth://totp/…` link or a bare base32 secret. The page sends `X-Janus-User: <username>` with every request; the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh janus` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://janus.<domain>`, or `https://localhost:8445` on WSL.

**The key.** The first install makes `/etc/axis-suite/janus.key` (32 random bytes, root-only) and says so. Later installs never replace it. **Copy it somewhere safe, apart from the server, right away**, e.g. into a password manager on another machine or onto a USB stick kept offline:

```bash
sudo cat /etc/axis-suite/janus.key
```

Without the key, `janus.db` can't be read by anyone, you included. The service refuses to start if the key is missing, or isn't the one the database was made with, and says which in `journalctl -u janus`. To move Janus to a new server, restore the key to `/etc/axis-suite/janus.key` (`sudo install -m 600 -o root -g root janus.key /etc/axis-suite/`) **before** its first install there.

**The database.** All users' vaults are in one file, `/var/lib/janus/janus.db` (one file: no write-ahead log). Back it up regularly, with the service stopped, and keep the copies where only you can read them:

```bash
sudo systemctl stop janus
sudo install -m 600 -o "$USER" /var/lib/janus/janus.db ~/janus-backup-$(date +%Y%m%d).db
sudo systemctl start janus
```

Keep database backups and the key apart: together they open every vault.

Vaults belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their vault (recycle bin included) is deleted the next time Janus starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them: the vault under the old name is deleted, and it couldn't be moved to the new name anyway (each value is bound to its owner). Export it before the rename and import it afterwards.

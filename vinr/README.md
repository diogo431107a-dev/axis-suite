# Vinr

A contacts manager. Vinr is Old Norse for "friend". Each contact has a name, company and job title, a birthday, phones (marked for WhatsApp), emails, postal addresses, websites, other dates to remember, and a memo; contacts can be starred and put in groups. Vinr has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own contacts and nobody else's.

| Layer    | Technology                                                         |
| -------- | ------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                   |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`            |
| Database | `/var/lib/vinr/vinr.db` on a server, `data/vinr.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                    |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
  contact.ts         names as shown and sorted, phone digits, WhatsApp links, the text search runs on
  dates.ts           days as YYYY-MM-DD, dates without a year (--MM-DD), ages, the next birthday
  words.ts           text without case or accents (for search)
  query.ts           the search language
server/
  index.ts           routes, /healthz, removed users' contacts, recycle-bin purge, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  store.ts           the only place contacts are read and written; import and its merging
web/
  list/              the list, A to Z, with the search box
  contact/           a contact, and the form that edits it
  upcoming/          birthdays and other dates coming up
  dialogs/           groups, settings, export and import
  io/vcard.ts        reading and writing vCard (.vcf) files
deploy/
  vinr.service       systemd unit (sandboxed)
  vinr.caddy         Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Contacts.** A contact needs a name (first, last or nickname) or a company; everything else is optional. Up to 5 phones, 5 emails, 3 addresses, 5 websites and 5 other dates. The first phone and the first email are the primary ones, shown in the list; the arrows in the form reorder them. A birthday or date may leave out the year (it is then kept as `--MM-DD`, as vCard does); with the year, Vinr shows the age. Someone born on 29 February has their birthday on the 28th in other years.

**Addresses** are Brazilian style: street, number, complement, district (bairro), city, state (UF), postal code (CEP) and country.

**WhatsApp.** A phone marked for WhatsApp gets a button that opens `https://wa.me/<number>`. That needs the country code: a number written with `+` (or `00`) has its own; any other gets the one in Settings (55, Brazil, unless changed), after dropping a leading 0.

**Saving.** The form saves when you press Save (or Ctrl+S). Leaving it with unsaved changes asks first. Every save names the version of the contact it was edited from; if the contact was saved elsewhere since (another tab, another device), Vinr says so and offers to load that version or to save yours over it. The star (favourite) is saved at once and never conflicts with an edit.

**Deleting.** A contact goes to the recycle bin and is deleted for good 30 days later (checked at start-up and daily), or when it is deleted from the bin. A group can be deleted at once: its contacts stay, outside it.

**Signing out.** If the session ends while someone is editing, a banner asks them to sign in again in a new tab; the form keeps what was typed, ready to save. If a different user signs in (in another tab), the page starts over with that user's contacts: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Using it

The sidebar has **All contacts**, **Favourites**, **Upcoming** (birthdays and dates of the next twelve months; the badge counts those in the next 7 days), the **groups** (+ makes one, the pencil renames, recolours or deletes it) and the **recycle bin**. The list sorts by first or last name (Settings), under letter headings.

**Search** (the box above the list) looks in every field: names, company, title, phones, emails, addresses, websites, date labels and the memo. Every word must match somewhere, in any case and with or without accents (`joao` finds "João"); `"exact phrase"` keeps words together. A word made of digits and phone punctuation also matches phone numbers however they were typed: `11987654321`, `98765-4321` and `(11) 98765-4321` all find `+55 (11) 98765-4321`. Within a group or Favourites, the search stays within it.

A contact's page has one-click links: call (`tel:`), WhatsApp, email (`mailto:`), the address in Google Maps, and a copy button on each. **vCard** downloads the contact as a `.vcf` file, to send or open on a phone.

| Keys   | Action                           |
| ------ | -------------------------------- |
| /      | Search                           |
| N      | New contact                      |
| E      | Edit the open contact            |
| Ctrl+S | Save (in the form)               |
| Esc    | Cancel the form (asks if needed) |

**Export and import** (sidebar).

- The **JSON backup** holds every contact (not the recycle bin), with favourites, WhatsApp marks, groups and settings. Vinr imports it again, here or for another user.
- **vCard** (`.vcf`) is for other apps: phones, Google Contacts, iCloud, Outlook. Vinr writes vCard 3.0, which all of them read, and reads 2.1 (older Android phones), 3.0 and 4.0. Groups go out and come back as categories. Favourites and WhatsApp marks aren't in a vCard, and photos aren't kept. Viewing a group, the dialog also exports just that group.
- **Importing** either kind adds to what is there. A contact matches one already here when the names are the same (ignoring case and accents) and they share a phone number (however written) or an email, or neither has any. The one here is then filled in: empty fields, phones, emails and other rows it lacks (up to the limits), and a memo it doesn't already contain. Anything else is added as a new contact, and groups are matched by name. Importing the same file twice changes nothing. A file with an error imports nothing.
- Vinr puts a Brazilian address's number and district on the vCard's single street line ("Avenida Paulista, 1000 - Bela Vista") and splits such a line back when reading.

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5177** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter vinr dev` starts only Vinr: the frontend on 127.0.0.1:5177 and the API on 127.0.0.1:3005. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter vinr test    # the server, vCard and browser tests (Vitest)
```

The database is created at `data/vinr.db` on first run. If `STATE_DIRECTORY` is set (systemd does), it lives there instead; the log's first line names the file in use.

## API

Every endpoint but `/healthz` requires a Heimdall session (`401 { error, loginUrl }` without one). Writes must be `application/json` and come from Vinr's own origin (`403` otherwise). Responses are never cached. Errors are `{ error, code? }`.

| Method | Path                                    | Description                                                                                                                                   |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/me                                 | The signed-in user: `{ username, name, accountUrl }`                                                                                          |
| GET    | /api/contacts?q&group&favorites=1&bin=1 | The contacts as the list shows them (primary phone and email, birthday and dates); a search, a group, the favourites or the recycle bin       |
| POST   | /api/contacts                           | A contact's fields (and `favorite`) → `{ id, rev, updatedAt }`                                                                                |
| GET    | /api/contacts/:id                       | The whole contact                                                                                                                             |
| PUT    | /api/contacts/:id                       | Its fields, `groupIds` and the `rev` it was edited from → `{ id, rev, updatedAt }`; `409 conflict` with the current `contact` if `rev` is old |
| PATCH  | /api/contacts/:id                       | `{ favorite }`                                                                                                                                |
| DELETE | /api/contacts/:id                       | Move to the recycle bin; with `?purge=1`, delete from the bin for good                                                                        |
| POST   | /api/contacts/:id/restore               | Take out of the recycle bin                                                                                                                   |
| GET    | /api/groups                             | The groups, with how many contacts are in each                                                                                                |
| POST   | /api/groups                             | `{ name, color? }` → the new group (`409 exists` if the name is taken, ignoring case)                                                         |
| PATCH  | /api/groups/:id                         | `{ name?, color? }`                                                                                                                           |
| DELETE | /api/groups/:id                         | Delete a group (its contacts stay)                                                                                                            |
| GET    | /api/settings                           | `{ sortBy: "first" \| "last", countryCode }`                                                                                                  |
| PUT    | /api/settings                           | The same                                                                                                                                      |
| GET    | /api/export                             | Every contact, group and setting as an export file                                                                                            |
| POST   | /api/import                             | An export file → `{ added, merged, unchanged, groups }`                                                                                       |
| GET    | /healthz                                | `ok` while the service runs (not served through Caddy)                                                                                        |

Revisions come from one counter for the whole database. A `PUT` of exactly what is stored always succeeds, so a save whose answer got lost can simply be sent again. Websites must be `http://` or `https://` (an address without a scheme gets `https://`). The page sends `X-Vinr-User: <username>` with every request; the API answers `409 other-user` if someone else is signed in. The types are in [`shared/protocol.ts`](shared/protocol.ts).

## Installing and data

Install it with the suite's installer, after Heimdall: `sudo bash axis-suite/deploy/install.sh vinr` (see the [suite README](../README.md#installing-on-a-server)). It is served at `https://vinr.<domain>`, or `https://localhost:8447` on WSL.

All users' contacts are in one file, `/var/lib/vinr/vinr.db` (one file: no write-ahead log). It is not encrypted, so keep backups where only you can read them, with the service stopped:

```bash
sudo systemctl stop vinr
sudo install -m 600 -o "$USER" /var/lib/vinr/vinr.db ~/vinr-backup-$(date +%Y%m%d).db
sudo systemctl start vinr
```

Each user can also export their own contacts (sidebar → Export and import).

Contacts belong to a Heimdall **username**. When a user is removed from Heimdall's `users.ts`, their contacts, groups and settings (recycle bin included) are deleted the next time Vinr starts (the installer restarts it when the list of users changes). Renaming a user counts as removing them: export the contacts before the rename and import them afterwards.

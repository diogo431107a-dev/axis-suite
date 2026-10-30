# Saga

**Habits Saga**: a habit tracker played as a pixel-art fantasy game. Your habits become companions, your one-off tasks become spells, and every real repetition is a blow against the Dragon's brood. Players are ranked in a public Hall of Fame.

Saga is the one module that **doesn't use Heimdall**. It has its own players, who join with an invite code, and it is meant for people outside the suite. It only shares the server, the installer and Caddy with the other modules.

The thinking behind the game is in `docs/`: the [philosophy](docs/philosophy.md), the [player's manual](docs/manual.md), the [lore](docs/lore.md), the [in-game help text](docs/help.md) and the [roadmap](docs/roadmap.md).

| Layer    | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| Frontend | Plain JavaScript and a canvas, bundled by Vite 8; pixel fonts bundled too |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                   |
| Database | `/var/lib/saga/saga.db` on a server, `data/saga.db` in development        |
| Sign-in  | Its own accounts: invite codes, scrypt passwords, a host-only cookie      |

```
server/
  index.ts           routes, /healthz, the sign-in throttle, the owner's /admin routes
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  accounts.ts        players, sessions and invite codes
  saves.ts           each player's saved game, and the ranking
  admin.ts           the owner's command line
  password.ts        scrypt hashing (a copy of Heimdall's)
web/
  data.js            every balance number (TUNE), attributes, classes, foes, items, statuses
  grids.js           the pixel art: sprite grids, props, battle backgrounds
  rules.js           the game itself: plain functions over the state object, no DOM
  sprites.js         grids into pixels, the battle backgrounds
  views.js           every screen, as HTML strings
  battle.js          the battle scene: the canvas loop and the turn's choreography
  sound.js           the sound effects, as note lists the browser plays, and the volume
  input.js           clicks, keys and forms
  net.js             the account, loading and saving the game, the ranking
  main.js            start-up
deploy/
  saga.service       systemd unit (sandboxed)
  saga.caddy         Caddy site: /api to the service, everything else from dist/web
```

## How it works

**The game runs in the browser.** All of a player's game is one object (`state`). The rules in `web/rules.js` change it, and the screens are drawn from it. The server never plays the game. It keeps it: about a second after anything changes, the page sends the whole game to `PUT /api/save` (and again as the tab closes), so a reload or another device carries on exactly where you were, in the middle of a battle included.

**Sound** is made in code too: each effect is a short list of notes in `web/sound.js`, played by the browser's Web Audio, so there are no sound files. It is always on. The volume slider on the Account page is kept in that browser only, not in the saved game.

**Trust.** An attack means "I just did this habit", so the game is played on trust anyway. The server checks only the shape and size of a save, not whether the moves in it were fair.

**Two tabs or devices.** Each save names the revision it was built on. If another tab or device saved in between, the server refuses it and the page reloads with the newer game and a notice, so nothing is overwritten by an older copy.

**New players** start with an empty roster, some gold and a starter bag. The camp asks for their first habit before they can fight.

**The Hall of Fame** is public: anyone can see it at `saga.<domain>`, signed in or not. It lists the top 100 by fame (ties by level) or by level (ties by fame), and a signed-in player also sees their own row below. A hero needs at least one habit to be listed. With every save the page also sends the numbers the ranking sorts by (level, fame, furthest foe, dragons). The server keeps them in columns next to the game, so ranking never needs to read the saved games.

**Accounts.** A player has a username (for signing in, never shown) and a hero name (public, unique). Joining needs an invite code from the owner. A session lasts 90 days, or 30 days without use. From the Account page a player can change their password, start over with a new hero (the account stays), sign out, or delete the account with its game. After 5 failed sign-ins or wrong invite codes, the client's address has to wait 15 minutes.

**Players are not Heimdall users.** The installer still hands Saga Heimdall's list of users, and lets Heimdall send people back to Saga after signing in. Saga ignores both. Browsers send Heimdall's cookie to `saga.<domain>` too (it is set for the whole domain), and Saga ignores that as well. Saga's own cookie is `__Host-saga`, which only `saga.<domain>` can set or read.

## The owner's commands

On the server, as root:

```bash
sudo node /opt/saga/dist/server/admin.js invite "for Ana"     # a new invite code, valid 30 days
sudo node /opt/saga/dist/server/admin.js invites              # every code, and who used it
sudo node /opt/saga/dist/server/admin.js players              # every player, their hero, level, fame
sudo node /opt/saga/dist/server/admin.js reset-password ana   # a temporary password; they choose a new one after signing in
sudo node /opt/saga/dist/server/admin.js rename-hero ana Ana the Bold
sudo node /opt/saga/dist/server/admin.js remove ana           # the player, their game and their place in the ranking
```

The commands ask the running service, which is the only thing that writes the database. On every start, the service writes a fresh token to `/var/lib/saga/admin.token`, and only root can read that file. The commands send that token to `http://127.0.0.1:3011/admin/…`. Caddy forwards only `/api`, so these routes can't be reached from outside.

In development: `pnpm --filter saga admin invite`.

## Development

```bash
pnpm --filter saga dev     # http://127.0.0.1:5183, the API on 127.0.0.1:3011
pnpm --filter saga admin invite
```

Data goes in `data/saga.db`. In development, a strip of tools under each page adds gold, defeats the current foe and so on. Those tools change the saved game. They are left out of the production build, because the ranking is public.

**Changing the game.** The balance numbers are all in `TUNE` in `web/data.js`. If a change reshapes the state object (a new field that old saves won't have, a renamed one), raise `GAME_VERSION` in `web/rules.js` and add a step to `MIGRATIONS` in `web/net.js` that upgrades an older save. Saves are upgraded when they are loaded.

## Installing and data

```bash
sudo bash deploy/install.sh saga
sudo node /opt/saga/dist/server/admin.js invite "me"
```

With a real domain, `saga.<domain>` needs a DNS record first, unless there is a wildcard. Every player, session, invite and saved game is in `/var/lib/saga/saga.db`. Back it up with the service stopped, as for every module (see the [suite README](../README.md#operating-it)).

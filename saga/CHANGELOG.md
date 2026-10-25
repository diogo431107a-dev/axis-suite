# Changelog

What changed in Saga, newest first. Each version is tagged in git as `saga-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.8 — 2026-10-25

- Companions can be deleted, from a Delete button on their card in the Roster. It asks first, and says what goes: the companion's level, skills and XP, and the attribute points it gave the hero, so the hero's level (and place in the Hall of Fame by level) can drop. Fame stays.
- Vices can be deleted the same way. The points they already took stay taken.
- Logging a vice asks first, on the Roster and in the Log a vice window, saying what it will take right now: the points, the gold, or an ailment when the purse can't pay.
- The number next to a companion's attribute now reads "+3 CRAFT": what the companion adds to the hero's sheet, 3 for each of its levels. Hovering over it says so.
- `admin.js invites` no longer lists a code as unused after the player who used it was removed (it couldn't be used again anyway), and says when a code has expired.

## 0.0.5 — 2026-10-25

The first numbered version: Saga as it is first installed on the server. Its 5 commits, this one included, give the number.

- Habits Saga, the habits game from the "Habits Fantasy" demo, at `saga.<domain>`. It has its own players, not Heimdall's: people join with an invite code you make on the server, and you reset forgotten passwords there too (see "The owner's commands" in its README).
- Each player's game is saved on the server as they play, so it carries on from any device, even mid-battle. Two tabs never overwrite each other: the older one reloads with the newer game.
- New players start with an empty roster instead of the demo's sample habits, vices and tasks.
- The Hall of Fame lists the real players, by fame or by level, and anyone can see it without signing in.
- The demo's prototype tools (+100 gold, defeat the foe…) are only there in development.
- **By hand:** before the first install, a DNS record for `saga.gansoazul.com.br` (unless there is a wildcard). After it, make your own invite with `sudo node /opt/saga/dist/server/admin.js invite "me"` and join.

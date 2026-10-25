# Changelog

What changed in Saga, newest first. Each version is tagged in git as `saga-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.5 — 2026-10-25

The first numbered version: Saga as it is first installed on the server. Its 5 commits, this one included, give the number.

- Habits Saga, the habits game from the "Habits Fantasy" demo, at `saga.<domain>`. It has its own players, not Heimdall's: people join with an invite code you make on the server, and you reset forgotten passwords there too (see "The owner's commands" in its README).
- Each player's game is saved on the server as they play, so it carries on from any device, even mid-battle. Two tabs never overwrite each other: the older one reloads with the newer game.
- New players start with an empty roster instead of the demo's sample habits, vices and tasks.
- The Hall of Fame lists the real players, by fame or by level, and anyone can see it without signing in.
- The demo's prototype tools (+100 gold, defeat the foe…) are only there in development.
- **By hand:** before the first install, a DNS record for `saga.gansoazul.com.br` (unless there is a wildcard). After it, make your own invite with `sudo node /opt/saga/dist/server/admin.js invite "me"` and join.

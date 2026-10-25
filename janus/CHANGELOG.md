# Changelog

What changed in Janus, newest first. Each version is tagged in git as `janus-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.7 — 2026-10-25

- Clicking Janus at the top left of the groups list opens an About box with Janus's version and the Axis Suite version it was built with. Every module of the suite opens its About box the same way. On a phone, open the groups first.

## 0.0.5 — 2026-10-13

The first numbered version: Janus as it runs in production on this date. Its 5 commits so far, this one included, give the number.

- A password manager in the style of KeePass: one vault per user, a tree of groups, entries with username, password, URL and notes, and a recycle bin (30 days).
- TOTP codes for two-factor sign-in, made on the server.
- A password and passphrase generator.
- Everything typed is encrypted (AES-256-GCM) with a key kept outside the database, in `/etc/axis-suite/janus.key`. That key must be backed up apart from the server.

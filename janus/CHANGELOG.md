# Changelog

What changed in Janus, newest first. Each version is tagged in git as `janus-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.5 — 2026-10-13

The first numbered version: Janus as it runs in production on this date. Its 5 commits so far, this one included, give the number.

- A password manager in the style of KeePass: one vault per user, a tree of groups, entries with username, password, URL and notes, and a recycle bin (30 days).
- TOTP codes for two-factor sign-in, made on the server.
- A password and passphrase generator.
- Everything typed is encrypted (AES-256-GCM) with a key kept outside the database, in `/etc/axis-suite/janus.key`. That key must be backed up apart from the server.

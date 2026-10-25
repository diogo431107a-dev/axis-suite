# Changelog

What changed in Althing, newest first. Each version is tagged in git as `althing-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.4 — 2026-10-25

- Althing's logo and name are at the top of the sidebar, above your profile. Clicking them opens an About box with Althing's version and the Axis Suite version it was built with. Every module of the suite opens its About box the same way.

## 0.0.2 — 2026-10-13

The first version of Althing. Its 2 commits so far, this one included, give the number.

- The suite's real-time chat: a lobby that is always open, rooms anyone can open and join (they close when everyone has left), and direct messages between two people.
- Everyone has a profile: one of twelve fun pictures, a nickname and "About me". The profile says that personal information is forbidden.
- "Online" means signed in to the suite, as Heimdall knows it.
- Everything is on record: messages can't be edited or deleted, closed rooms stay in the database, and so do room visits and old nicknames. The README shows how to read the record on the server.
- A user removed from Heimdall loses their profile, but what they said stays, as "deleted user".
- **By hand:** install Heimdall again first (it gained `GET /online`), then Althing. With a real domain, `althing.<domain>` needs a DNS record (gansoazul.com.br already has one).

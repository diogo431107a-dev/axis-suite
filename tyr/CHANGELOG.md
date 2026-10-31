# Changelog

What changed in Tyr, newest first. Each version is tagged in git as `tyr-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.4 — 2026-10-31

- Tyr, a dossier of people, at `tyr.<domain>`. Sign in with Heimdall; each user has their own private drawer, saved in Tyr's own database.
- The drawer: files in A to Z order by first name. Just met opens a file and its first entry in one step. Files go dormant after six months without contact, and can be closed, reopened or destroyed.
- Entries: what was said or seen, with when it happened, when you were told, and when you typed it, which never changes. Vague dates are fine. Every entry says whether it was unprompted, invited, prompted, observed or inferred, and what you asked for is kept in its own ledger, with a warning that never blocks.
- Entries are added, not overwritten: a correction is a new entry linked to the old one.
- Muninn: capture one line in ten seconds, and complete it later from Threads.
- The profile: sixteen questions answered in your own words, each pointing back to the entries behind it, with earlier versions kept.
- The timeline, follow-ups, Places and Search across every file.
- **By hand:** with a real domain, add a DNS record for `tyr.<domain>` before installing, unless a wildcard covers it.

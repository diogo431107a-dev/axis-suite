# Changelog

What changed in Tyr, newest first. Each version is tagged in git as `tyr-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.8 — 2026-10-31

- Handle with care, first on every file: what to do, not the story behind it, with levels, a date that is hard for them, and notes you can change, confirm or retire.
- Word given, both ways, with an optional due date. Mark each kept, broken or released; a mistaken click can be undone the same day.
- Concerns: a worry waits for its review date before anything can be decided. A breach needs a review note and evidence beyond your own conclusions, and the file shows what is to their credit beside it.
- Said about me: what you were told someone said about you. Always flagged as hearsay, kept out of the profile and timeline, and never evidence.
- Where I read them wrong: a record of your own errors.
- Incidents: entries and hearsay in one timeline, with what is known and its history, across several files.
- Before I see them: one page to read before meeting someone.
- Entries can be marked to their credit and linked to an incident, also later. In Muninn, `!care` files a care note with the entry.
- Threads and Search now cover all of this.
- **By hand:** this upgrades the database, adding to it without changing your entries. Back up `/var/lib/tyr/tyr.db` before installing, as in the suite README.

## 0.0.4 — 2026-10-31

- Tyr, a dossier of people, at `tyr.<domain>`. Sign in with Heimdall; each user has their own private drawer, saved in Tyr's own database.
- The drawer: files in A to Z order by first name. Just met opens a file and its first entry in one step. Files go dormant after six months without contact, and can be closed, reopened or destroyed.
- Entries: what was said or seen, with when it happened, when you were told, and when you typed it, which never changes. Vague dates are fine. Every entry says whether it was unprompted, invited, prompted, observed or inferred, and what you asked for is kept in its own ledger, with a warning that never blocks.
- Entries are added, not overwritten: a correction is a new entry linked to the old one.
- Muninn: capture one line in ten seconds, and complete it later from Threads.
- The profile: sixteen questions answered in your own words, each pointing back to the entries behind it, with earlier versions kept.
- The timeline, follow-ups, Places and Search across every file.
- **By hand:** with a real domain, add a DNS record for `tyr.<domain>` before installing, unless a wildcard covers it.

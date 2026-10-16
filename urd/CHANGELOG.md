# Changelog

What changed in Urd, newest first. Each version is tagged in git as `urd-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 1.0.0 — 2026-10-15

The first numbered version: Urd as it runs in production on this date. It starts at 1.0.0 rather than at its commit count, which would have made it 0.0.4. From here, every change is classified as major, minor or a fix.

- The suite's time tracker, made to stay open all day: a big clock and one Play/Stop button (or Space). No pause, no pomodoro, no breaks.
- Sessions have an optional project and tags, set before, during or after them; History lists the ones still without a project.
- A forgotten session stops by itself at midnight; one started at 22:00 or later runs until 05:00. Its time counts for the day it started.
- Time and interruptions (every play/stop) for the session, today, this week (from Monday), this month and overall, per project and for all.
- Each project can have an estimate, lengthened or shortened at any time, with the history of its changes.
- Sessions can be shortened or deleted, never lengthened. Every session downloads as CSV.
- Every open tab and device follows a start or stop at once. The tab's title shows the running time.
- **By hand:** with a real domain, `urd.<domain>` needs a DNS record (for gansoazul.com.br, unless a wildcard record already covers it).

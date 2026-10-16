# Changelog

What changed in Urd, newest first. Each version is tagged in git as `urd-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 2.0.0 — 2026-10-16

- **Major:** Urd never stops a session by itself any more: a session runs until you press Stop, however long that is. Sessions that stopped by themselves before keep that stop.
- **Major:** Time that runs past midnight is split between the two days (and their weeks and months), instead of all counting for the day it started. "Today" is always today, and a session past midnight shows on both days in History.
- **Minor:** Tasks. A session can have a task, inside a project or on its own. Projects lists each project's tasks with their time and interruptions (its time without a task first, then the tasks in the order they were started), and the tasks without a project; a click renames a task or moves it to another project. "Without a project" in History is now "Unnamed": sessions with neither a project nor a task.
- **Minor:** Resume: the latest tasks under the timer, each started again in one click with the tags it had; a running session stops for it. Choosing a project or task also brings its last tags, instead of keeping the previous session's.
- **Minor:** The longest uninterrupted work (one session, from Play to Stop) for the session, today, this week, this month and overall. The numbers now show the task, the project or all, chosen with a switch.

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

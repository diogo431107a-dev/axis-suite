# Changelog

What changed in Chronos, newest first. Each version is tagged in git as `chronos-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

- Clicking Chronos at the top left opens an About box with Chronos's version and the Axis Suite version it was built with. Every module of the suite opens its About box the same way.

## 0.0.5 — 2026-10-13

The first numbered version: Chronos as it runs in production on this date. Its 5 commits so far, this one included, give the number.

- A calendar with any number of calendars per user, each with a colour, that can be shown or hidden. Month and Agenda views.
- Timed events are stored in UTC and shown in one home zone. All-day events are plain dates.
- Import from iCalendar (`.ics`) files. Importing the same file again updates its events, and repeating events are expanded.
- Sharing a calendar with other users, to read or to edit.

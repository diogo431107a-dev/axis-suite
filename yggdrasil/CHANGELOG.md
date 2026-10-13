# Changelog

What changed in Yggdrasil, newest first. Each version is tagged in git as `yggdrasil-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 1.0.0 — 2026-10-13

The first numbered version: Yggdrasil as it runs in production on this date. Its development map is complete, so it starts at 1.0.0 rather than at its commit count, which would have made it 0.0.16. From here, every change is classified as major, minor or a fix.

- An outliner in the style of Workflowy and Dynalist: one tree of bullets per user, any bullet can be zoomed into, and the keyboard does nearly everything (keys in the README).
- Dynalist's inline markup: bold, italic, strike, code, links, `#tags`, `@mentions` and date chips. Search with words, phrases, tags and operators such as `has:date` or `date:overdue`.
- Changes are saved in the background and kept in the browser while offline. Other tabs and devices update live.
- Sharing a bullet, with everything under it, with other users to read or edit.
- Images and files in a bullet's text, up to 200 MB each, kept in `/var/lib/yggdrasil/files/` next to `tree.db`. Backups must cover that whole folder.
- Alt+S to star. OPML import; export as OPML, plain text or Markdown.

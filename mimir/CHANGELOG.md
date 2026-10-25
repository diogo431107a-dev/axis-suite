# Changelog

What changed in Mimir, newest first. Each version is tagged in git as `mimir-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

- Clicking Mimir at the top left opens an About box with Mimir's version and the Axis Suite version it was built with. Every module of the suite opens its About box the same way.

## 0.0.4 — 2026-10-13

The first version of Mimir. Its 4 commits so far, this one included, give the number.

- The suite's mind maps: any number of maps per user, each growing from one idea in the middle to both sides, laid out by itself.
- Nodes hold text; links in them open with a click. Relationship arrows, with an optional label, join any two nodes.
- Everything works from the keyboard (Tab, N, arrows, Ctrl+Shift+arrows, Space to fold, A for arrows), the mouse (drag nodes, pan, zoom) and a finger. Ctrl+Z undoes.
- Copy and paste with Yggdrasil, OPML in and out, a PNG picture of a map or a branch, and a backup of every map.
- **By hand:** with a real domain, `mimir.<domain>` needs a DNS record (gansoazul.com.br already has one).

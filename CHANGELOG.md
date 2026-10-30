# Changelog

The Axis Suite as a whole, newest first: each version says which version of every module it is made of. What changed inside a module is in that module's own `CHANGELOG.md`. Each suite version is tagged in git as `axis-suite-v<version>`. How versions are numbered and released is in the [README](README.md#versions-and-changelogs).

## Unreleased

## 0.0.131 — 2026-10-30

A new module, Fafnir Personal Finances (`fafnir`): what you have, what you owe and where your money goes, in US dollars, with its own database and sign-in through Heimdall. The other modules are unchanged.

**By hand:** before the first install, make sure `fafnir.<domain>` points at the server. Fafnir fetches exchange rates from outside, so if the server limits outgoing connections, allow HTTPS to `olinda.bcb.gov.br` and `api.frankfurter.dev`.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.21  |
| Loggbok   | 0.0.16  |
| Yggdrasil | 1.0.2   |
| Janus     | 0.0.7   |
| Papyrus   | 0.0.7   |
| Vinr      | 0.0.6   |
| Chronos   | 0.0.7   |
| Valkyrie  | 0.0.6   |
| Althing   | 0.0.4   |
| Mimir     | 0.0.6   |
| Urd       | 2.1.0   |
| Saga      | 1.0.0   |
| Star      | 0.0.4   |
| Fafnir    | 0.0.2   |

## 0.0.127 — 2026-10-30

A new module, Every Man is a Star (`star`): the people you know and their families, charted as a night sky, with its own database and sign-in through Heimdall. The other modules are unchanged.

**By hand:** before the first install, make sure `star.<domain>` points at the server.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.21  |
| Loggbok   | 0.0.16  |
| Yggdrasil | 1.0.2   |
| Janus     | 0.0.7   |
| Papyrus   | 0.0.7   |
| Vinr      | 0.0.6   |
| Chronos   | 0.0.7   |
| Valkyrie  | 0.0.6   |
| Althing   | 0.0.4   |
| Mimir     | 0.0.6   |
| Urd       | 2.1.0   |
| Saga      | 1.0.0   |
| Star      | 0.0.4   |

## 0.0.122 — 2026-10-30

Saga reaches 1.0.0, with the story in its labels, an in-game help and the Angel's place. The other modules are unchanged.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.21  |
| Loggbok   | 0.0.16  |
| Yggdrasil | 1.0.2   |
| Janus     | 0.0.7   |
| Papyrus   | 0.0.7   |
| Vinr      | 0.0.6   |
| Chronos   | 0.0.7   |
| Valkyrie  | 0.0.6   |
| Althing   | 0.0.4   |
| Mimir     | 0.0.6   |
| Urd       | 2.1.0   |
| Saga      | 1.0.0   |

## 0.0.115 — 2026-10-25

Every module has an About box: click its logo or name at the top left to see its version and the Axis Suite version it was built with. All twelve modules get a new version for it, and Urd 2.1.0 also brings dark mode and New task. A module that hasn't been reinstalled for a while shows the suite version it was last installed from.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.21  |
| Loggbok   | 0.0.16  |
| Yggdrasil | 1.0.2   |
| Janus     | 0.0.7   |
| Papyrus   | 0.0.7   |
| Vinr      | 0.0.6   |
| Chronos   | 0.0.7   |
| Valkyrie  | 0.0.6   |
| Althing   | 0.0.4   |
| Mimir     | 0.0.6   |
| Urd       | 2.1.0   |
| Saga      | 0.0.12  |

## 0.0.101 — 2026-10-25

Saga 0.0.10: Habits Saga has sound, with a fanfare for victories, a sad tune for Game Over, coins at the shop, battle sounds, and a volume slider on the Account page.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.14  |
| Yggdrasil | 1.0.1   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |
| Urd       | 2.0.0   |
| Saga      | 0.0.10  |

## 0.0.99 — 2026-10-25

Saga 0.0.8: companions and vices can be deleted, logging a vice asks first, and the number next to a companion's attribute reads "+3 CRAFT".

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.14  |
| Yggdrasil | 1.0.1   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |
| Urd       | 2.0.0   |
| Saga      | 0.0.8   |

## 0.0.96 — 2026-10-25

Saga 0.0.5: Habits Saga joins the suite at `saga.<domain>`, a habits game with its own players (by invite code), saved games and a public Hall of Fame. It is the one module that doesn't sign in through Heimdall.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.14  |
| Yggdrasil | 1.0.1   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |
| Urd       | 2.0.0   |
| Saga      | 0.0.5   |

## 0.0.89 — 2026-10-16

Urd 2.0.0: no session stops by itself any more, time past midnight is split between the days, sessions can have tasks, recent tasks resume in one click with their tags, and the numbers show the longest uninterrupted work.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.14  |
| Yggdrasil | 1.0.1   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |
| Urd       | 2.0.0   |

## 0.0.84 — 2026-10-15

Loggbok 0.0.14: a download arrow saves the open note as a text file. Urd, the suite's time tracker, gets its first version, 1.0.0.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.14  |
| Yggdrasil | 1.0.1   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |
| Urd       | 1.0.0   |

## 0.0.82 — 2026-10-15

Yggdrasil 1.0.1: letters typed just before a short pause no longer disappear.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.12  |
| Yggdrasil | 1.0.1   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |

## 0.0.74 — 2026-10-13

Mimir joins the suite: mind maps that lay themselves out from the centre to both sides, with relationship arrows, OPML in and out, and PNG pictures.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.12  |
| Yggdrasil | 1.0.0   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |
| Mimir     | 0.0.4   |

## 0.0.68 — 2026-10-13

Althing joins the suite: a real-time chat with a lobby, rooms and direct messages, all kept on record. Heimdall can now tell Althing who is signed in.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.17  |
| Loggbok   | 0.0.12  |
| Yggdrasil | 1.0.0   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |
| Althing   | 0.0.2   |

## 0.0.65 — 2026-10-13

The first numbered version: the suite as it runs in production on this date. Its 65 commits so far, this one included, give the number.

| Module    | Version |
| --------- | ------- |
| Heimdall  | 0.0.15  |
| Loggbok   | 0.0.12  |
| Yggdrasil | 1.0.0   |
| Janus     | 0.0.5   |
| Papyrus   | 0.0.5   |
| Vinr      | 0.0.4   |
| Chronos   | 0.0.5   |
| Valkyrie  | 0.0.4   |

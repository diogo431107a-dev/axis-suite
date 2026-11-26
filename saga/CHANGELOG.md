# Changelog

What changed in Saga, newest first. Each version is tagged in git as `saga-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 1.1.1 — 2026-11-26

- **Fix:** Runs on Node.js 24 instead of 22. The installer upgrades Node.js on the server by itself the first time it runs.

## 1.1.0 — 2026-11-14

- **Minor:** Dates. Each companion's card says when you last did its habit ("Last done yesterday · 13 Nov"), and each vice's card says when you last paid it. A new **History** button on both shows the last 7 days, the last 30 days and all time, then every day it happened. Dates are kept from this version on, so older check-ins and tithes have none.
- **Minor:** The Chronicle shows the date of each line, and **Show all** opens up to its last 200 lines.
- **Minor:** A vice now costs more the more often you pay it: each tithe in the last 7 days raises the next one. After 7 days without one it is back to its first price. Victories no longer cool vices, so any extra cost your vices carry now goes away.
- **Minor:** A vice's price is chosen only when you name it. The sliders have left its card.
- **Minor:** Beaten foes sometimes leave a chest of shop items, a few of each, and a boss always does. The battle report lists what was inside.
- **Minor:** The attribute list no longer shows what vices have taken in purple. The numbers already count it.

## 1.0.0 — 2026-10-30

Saga's development map is complete: the first version numbered as finished. From here on, each change is classified as Major, Minor or Fix.

- **The Angel's place.** Every hero chooses, once and for their whole road, who stands there: Lunaria by right, or Alecta usurping her. New heroes choose after the story, and existing heroes on their next visit. A gold bar fills slowly on turns when you do a deed. When it is full she arrives, with her painting, and stays 6 turns. Beside Lunaria each companion strikes again after acting, takes less damage and recovers each turn. Beside Alecta the foe takes more and deals less, and critical hits come far more often. The extra attack is only damage: it records nothing and raises no mastery. Neither Angel strikes a blow.
- The game now tells a story. A new hero sees its opening once, and existing heroes see it once on their next visit. Regions, foes, titles and buttons speak in its voice: "Pay the tithe" replaces "Log a vice", "Run" replaces "Flee", and the party falls and wakes at camp instead of "Game Over".
- Screens are much emptier. Most explanations left the game for the manual, including what spells do and how foes attack. Damage, HP, MP, gold and levels stay, and so do the warnings before anything irreversible.
- A **?** at the top of every screen, battle included, opens a short help with a link to the manual.
- Each companion's card has a **Note** for your own words on the habit, and its mastery, spell and flee levels are now behind a **Skills** button.
- Creating a habit with a full party no longer asks who steps out: the new companion waits on the bench.
- New companions and vices start on the attribute you are viewing, not always Body, and the Roster stays on that attribute afterwards.
- The Spellbook stays on the school you picked after you add a task, so you can write several in a row. It starts on the attribute the Roster is showing.
- Resolve now means exceptional work and extra effort, not only finished projects.
- New documents in `saga/docs`, for you to review: the philosophy behind the game and its attributes, a player's manual, a draft of the lore, the text for an in-game help, and a roadmap of what changes next. A credits file names the Civitai users the art of Lunaria and Alecta came from.

## 0.0.12 — 2026-10-25

- Clicking HABITS SAGA at the top left opens an About box with Saga's version and the Axis Suite version it was built with. Every module of the suite opens its About box the same way.

## 0.0.10 — 2026-10-25

- Habits Saga has sound: a fanfare for victories, a sad tune for Game Over, coins at the shop and the inn, and sounds for hits, misses, spells, items, guarding, fleeing, vices and level-ups. The volume is a slider at the top of the Account page, remembered on each device (0 is silent).

## 0.0.8 — 2026-10-25

- Companions can be deleted, from a Delete button on their card in the Roster. It asks first, and says what goes: the companion's level, skills and XP, and the attribute points it gave the hero, so the hero's level (and place in the Hall of Fame by level) can drop. Fame stays.
- Vices can be deleted the same way. The points they already took stay taken.
- Logging a vice asks first, on the Roster and in the Log a vice window, saying what it will take right now: the points, the gold, or an ailment when the purse can't pay.
- The number next to a companion's attribute now reads "+3 CRAFT": what the companion adds to the hero's sheet, 3 for each of its levels. Hovering over it says so.
- `admin.js invites` no longer lists a code as unused after the player who used it was removed (it couldn't be used again anyway), and says when a code has expired.

## 0.0.5 — 2026-10-25

The first numbered version: Saga as it is first installed on the server. Its 5 commits, this one included, give the number.

- Habits Saga, the habits game from the "Habits Fantasy" demo, at `saga.<domain>`. It has its own players, not Heimdall's: people join with an invite code you make on the server, and you reset forgotten passwords there too (see "The owner's commands" in its README).
- Each player's game is saved on the server as they play, so it carries on from any device, even mid-battle. Two tabs never overwrite each other: the older one reloads with the newer game.
- New players start with an empty roster instead of the demo's sample habits, vices and tasks.
- The Hall of Fame lists the real players, by fame or by level, and anyone can see it without signing in.
- The demo's prototype tools (+100 gold, defeat the foe…) are only there in development.
- **By hand:** before the first install, a DNS record for `saga.gansoazul.com.br` (unless there is a wildcard). After it, make your own invite with `sudo node /opt/saga/dist/server/admin.js invite "me"` and join.

# Saga roadmap

**For review.** What is expected to change in Saga, in an order where early work isn't undone by later work.

Items tagged #review or #approved in the owner's notes, and what the owner asked for directly, are guaranteed. Everything else is under deliberation, with no promise that it happens.

## The order at a glance

| Phase | Work                                  | Status       | Why it comes here                                        |
| ----- | ------------------------------------- | ------------ | -------------------------------------------------------- |
| 0     | The documents                         | Guaranteed   | Everything below refers to them                          |
| 1     | Two small fixes                       | Guaranteed   | Independent of everything else                           |
| 2     | Roster cards and notes                | Guaranteed   | One redesign of the card, one change to the saved game   |
| 3     | In-game help, then strip explanations | Guaranteed   | Explanations need a new home before they leave           |
| 4     | Lore in the labels                    | Guaranteed   | Only what survives phase 3 gets rewritten, and only once |
| 5     | Roster simple/detailed mode           | Deliberation | May be unnecessary after phase 2                         |
| 6     | Inn art and clerk                     | Deliberation | Speaks in the voice set by phase 4                       |
| 7     | Damage formula and misses             | Deliberation | Angel mode's bonuses are tuned against these numbers     |
| 8     | Angel mode                            | Deliberation | Needs the lore and the final combat numbers              |

## Guaranteed

### Phase 0: The documents

- [Philosophy](philosophy.md), including the theory of why the attributes are as they are (#review).
- [Manual](manual.md), [lore](lore.md), [in-game help text](help.md) and this roadmap.
- Resolve is redefined as exceptional work and extra effort. The documents take this up now, and the game's own wording follows in phase 4.

### Phase 1: Two small fixes

- **Remove the "who steps out?" screen after creating a habit** (#review #approved). A new habit waits on the bench when the party is full. The screen comes from `web/input.js:350`. The same screen stays for the Join button (`input.js:70`), where you are in fact asking someone to join.
- **New companions default to the attribute you're viewing** (#review). Confirmed as a bug: `attrPicker` in `web/views.js:396` always selects Body, whichever filter is on. With a filter on Resolve, the new habit should default to Resolve. Creating a habit also resets the filter to All (`input.js:349`), and that should stop too, so the new companion shows up where you were looking.

**Decision for the owner:** should the new-vice form follow the same rule? It shares the picker. Suggested: yes.

### Phase 2: Roster cards and notes

These go together. The card is redesigned once, with the notes in mind, and both notes change the saved game, so they share one upgrade step (`GAME_VERSION` in `web/rules.js`, `MIGRATIONS` in `web/net.js`).

- **Mastery, spell and flee levels behind a button** (#review), to save space.
- **A note for each companion** on the Roster (#review). Why this habit, what counts as doing it, what the current goal is.
- **An optional note when attacking** (#review). It must stay truly optional: keys 1 to 5 and the Attack button still strike at once, and the note is a separate small button.

**Decision for the owner:** where do attack notes live? The chronicle keeps only the last 80 entries and shows 6, so it won't hold them for long. The whole saved game must also stay under the server's 512 KB limit (`server/index.ts:39`). Suggested: each companion keeps its most recent 50 notes, viewable from its card.

### Phase 3: In-game help, then strip the explanations

The order inside this phase matters: the help has to exist before the explanations go.

1. **Online help in the game** (#review), using [the draft text](help.md), one click away from any screen. Battle included.
2. **A way to reach the manual.** The manual is currently only a file in the repository. Suggested: a link from the help page. Serving a copy from `saga.<domain>` would be neater, but that is more work for little gain at the start.
3. **Strip what the manual now covers.** The inventory, from `web/views.js`:
   - The note under the hero's Attributes, and each attribute's blurb on the sheet.
   - The intro paragraphs of the Roster, Vices, Spellbook, Shop, Bestiary and Hall of Fame.
   - The Battle hint under the party's turn.
   - "Victory pays…" on the foe's card, and the Inn's paragraph.
   - The Travel and Log a vice introductions, and the vice card's notes on heat and gold.

**What stays, in plain words:**

- Warnings before irreversible actions: deleting a companion or a vice, logging a vice, starting over and deleting the account.
- Damage, HP, MP, gold and levels.
- Everything on the Account page and in sign-in forms. Those belong to the player's account, not to the game's mystery.

**Watch out:** the attribute picker for a new habit shows only each attribute's name and class. Today the descriptions live on the hero's sheet, so once they are stripped, a new player has nothing to classify a habit with. Suggested: a link from the picker to the attributes in the help or manual.

**Decision for the owner:** a foe's description of its attacks ("bites one member 1–3 times") and the HP and rewards listed in the Bestiary. Are those explanations or the numbers of a fight? Suggested: keep HP, remove the attack descriptions and rewards, so the Bestiary fills in by being fought.

### Phase 4: Lore in the labels

Needs [the lore](lore.md) approved first.

- A short opening told at the start of a new game, and "A decent story" from the notes carried through in fragments.
- All 48 foe lines rewritten in-world. Some samples are in the lore document.
- Titles and the villagers' mockery, fading as the hero climbs.
- Remaining labels in the lore's voice, and the Spellbook's "things that resist structure" dropped.
- Attribute blurbs rewritten, including the new meaning of Resolve.
- README intro and welcome screen brought in line.

None of this changes the saved game: the labels are drawn from `web/data.js` and `web/views.js`, and old saves hold only the keys.

## Under deliberation

No promise on any of these. They are in the order they should happen if they happen.

### Phase 5: Roster simple/detailed mode

Phase 2's button may already solve this. Decide after living with it.

### Phase 6: Inn art and clerk

- Art for the inn, in `web/grids.js` like the rest of the game's pixel art.
- A short dialog with a clerk who greets you and states the price, explaining in their own words that it follows the tier of the region. For example: "Fifteen a head in the meadows. Up in the Peaks, you'll pay for the view."

This replaces the inn's panel on the camp page, which frees space there.

### Phase 7: Damage formula and misses

**"It seems the attacks never miss."** Correct: only Blind causes a miss, and it's a 50% chance. Foes never miss either. A base hit chance and evasive foes (bats, wisps) would add texture. One rule is fixed whatever is chosen: **a miss still records the habit**, as Blind already does, because the real repetition happened.

**"How do professional games handle the damage formula?"** There are three broad families. The formulas here are simplified and from general knowledge, not checked against each game's sources.

| Family       | Shape                                                                    | Examples                  | Good                                         | Bad                                                               |
| ------------ | ------------------------------------------------------------------------ | ------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Subtractive  | `attack − defence`                                                       | Dragon Quest, early RPGs  | Easy to read. Defence feels strong.          | Falls to almost nothing when a foe outgrows you. Needs a minimum. |
| Ratio        | `power × attack ÷ defence`                                               | Pokémon, many modern RPGs | Stays sensible across large ranges of stats. | Less intuitive by hand, and a single stat rarely feels decisive.  |
| Level-scaled | Damage grows with level and stats multiplied, then is reduced by defence | Final Fantasy series      | Levels feel powerful. Big numbers feel good. | Harder to balance, and can run away at the top.                   |

Nearly all of them add a small random spread, critical hits, and multipliers for element or status.

**What Saga does today:** `(8 + 4 × level + points) × 1.06^(mastery − 1)`, ±10%, with a 10% chance of ×1.5. There is no defence, so a foe's toughness is only its HP. Two oddities surfaced while writing the manual:

- `points` is always 3 × level, so level and points are one number: effectively `8 + 7 × level`.
- The hero's attribute sheet has no effect on combat at all. It only sets the hero's level, which only counts for the ranking.

**Recommendation:** a ratio formula, with a defence value for each foe family. Foes' HP grows by ×1.75 per tier, so a subtractive formula would swing between useless and overwhelming. Give the hero's sheet a small party-wide effect, so the attributes matter in battle.

Any change here needs the balance simulated again. `TUNE` in `web/data.js` was tuned that way, and today's numbers assume a first knockout within about 5 fights.

### Phase 8: Angel mode

Like Trance in Final Fantasy IX: a bar fills slowly and, once full, gives benefits for a few turns before resetting to zero. It matches the patron chosen at the start.

- **Build-up:** about 33 turns, faster with engagement and damage dealt.
- **Duration:** about 6 turns. Short, but long enough to be missed.
- **The patron arrives and delivers the benefits, and doesn't attack.** The lore explains why: angels and devils may not strike a blow.
- **The holy angel:** an extra attack for each party member after using their action, damage reduction, HP and MP regeneration each turn.
- **The succubus:** negative effects on the foe, and extra critical chance for the party.

Things to settle:

- **The extra attack must not count as a check-in**, or the game records a repetition that never happened. It should add damage only, not raise mastery.
- **Existing players** need a way to choose a patron, since it is otherwise chosen when starting. Suggested: the first time the bar would start to fill, or an event on the road.
- **Saved game:** the patron and the bar need a new upgrade step.
- **"The angel joins the party in a special place":** assumed to be a slot apart from the five, shown only while the patron is present. **The owner should confirm.**
- **Art:** `holy_angel.png` and `succubus.png` are in `C:\Users\diogo\Claude\assets\angels`, but they are detailed paintings and the game is pixel art. Two options: show the painting as a full-screen moment when the patron arrives, or draw pixel sprites from it. Suggested: both, the painting for the arrival and a sprite for the turns that follow. The succubus file is 2.4 MB and needs shrinking for the web. Neither goes into the repository before this phase, and the repository is public.

## Open questions from the documents

- **Charisma's "Likes".** The notes say "Likes and social things". The manual reads this as sharing your work where people can respond to it, plus plain social contact. The owner should confirm what "likes" meant.
- **Names in the lore.** Aurael and Vesper are invented for the draft.
- **Tasks and the Finish school.** The manual says a task that took unusual effort goes in Finish, whatever its subject. This means a task's school now depends on effort for this one school and on subject for the other seven. Worth seeing how it plays.

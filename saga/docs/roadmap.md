# Saga roadmap

**For review.** What is expected to change in Saga, in an order where early work isn't undone by later work.

Items tagged #review or #approved in the owner's notes, and what the owner asked for directly, are guaranteed. Everything else is under deliberation, with no promise that it happens.

## The order at a glance

| Phase | Work                                  | Status       | Why it comes here                                        |
| ----- | ------------------------------------- | ------------ | -------------------------------------------------------- |
| 0     | The documents                         | Done         | Everything below refers to them                          |
| 1     | Two small fixes                       | Done         | Independent of everything else                           |
| 2     | Roster cards and notes                | Done         | One redesign of the card, one change to the saved game   |
| 3     | In-game help, then strip explanations | Done         | Explanations need a new home before they leave           |
| 4     | Lore in the labels                    | Done         | Only what survives phase 3 gets rewritten, and only once |
| 5     | Roster simple/detailed mode           | Deliberation | May be unnecessary after phase 2                         |
| 6     | Inn art and clerk                     | Deliberation | Speaks in the voice set by phase 4                       |
| 7     | Damage formula and misses             | Deliberation | Angel mode's bonuses are tuned against these numbers     |
| 8     | Angel mode                            | Deliberation | Needs the lore and the final combat numbers              |

## Done

### Phase 0: The documents

[Philosophy](philosophy.md) with the theory of the attributes, [manual](manual.md), [lore](lore.md), [in-game help text](help.md) and this roadmap.

### Phase 1: Two small fixes

- The "who steps out?" screen no longer appears after creating a habit. With the party full, a new companion waits on the bench. The same screen stays on the Join button, where you are in fact asking someone to join.
- New companions and new vices start on the attribute being viewed. The filter stays on after creating one, unless the new one wouldn't show under it.

### Phase 2: Roster cards and notes

- Mastery, spell and flee levels are behind a Skills button on each card.
- Each companion has a note of up to 500 characters, behind a Note button. Older saves upgrade on load (`GAME_VERSION` 5).
- **Rejected by the owner:** an optional note when attacking.

### Phase 3: In-game help, then strip the explanations

- The **?** at the top of every screen, battle included, opens [the help](help.md). It links to the manual on GitHub, the simplest way to reach it for now.
- Stripped: the Attributes note and blurbs on the sheet, page introductions, the battle hint, "Victory pays…", the Inn's explanation, the Travel and tithe introductions, the note on heat, the tooltip on a companion's points, spell effects in the Spellbook and in battle.
- Foes' attack descriptions and the rewards in the Bestiary are gone too. HP stays. The attack list moved to the manual.
- The attribute descriptions moved into the help, and the attribute picker links there, so a new player can still classify a habit.

**Stayed, in plain words:** warnings before irreversible actions (deleting a companion or a vice, paying a tithe, starting over, deleting the account), damage, HP, MP, gold and levels, and the Account page and sign-in forms.

### Phase 4: Lore in the labels

- The story's opening appears once for each hero, and again from the help.
- A line of story arrives in the chronicle when the party reaches each region, and those lines also head the Bestiary's regions.
- Foe lines that named the real world are rewritten in-world.
- Titles now say who is speaking: the villagers at first, the songs from 25 fame.
- Labels speak the lore's language: "Pay the tithe", "Run", "Call a companion", "The party falls". Attack, Spell, Item and Guard stay, as classic RPG words every player knows.
- Attribute blurbs carry the new meaning of Resolve.

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

Like Trance in Final Fantasy IX: a bar fills slowly and, once full, gives benefits for a few turns before resetting to zero. It matches the Angel chosen at the start: Lunaria, whose rightful place it is, or Alecta, who usurps it and loves it. The game has no neutral word such as "patron". Whoever holds the place is the Angel.

- **Build-up:** about 33 turns, faster with engagement and damage dealt.
- **Duration:** about 6 turns. Short, but long enough to be missed.
- **The Angel arrives and delivers the benefits, and doesn't attack.** The lore explains why: angels and devils may not strike a blow.
- **Lunaria, the rightful Angel:** an extra attack for each party member after using their action, damage reduction, HP and MP regeneration each turn.
- **Alecta, the usurper:** negative effects on the foe, and extra critical chance for the party.

Things to settle:

- **The extra attack must not count as a check-in**, or the game records a repetition that never happened. It should add damage only, not raise mastery.
- **Existing players** need a way to choose their Angel, since it is otherwise chosen when starting. Suggested: the first time the bar would start to fill, or an event on the road.
- **Saved game:** the choice of Angel and the bar need a new upgrade step.
- **"The angel joins the party in a special place":** assumed to be a slot apart from the five, shown only while the Angel is present. **The owner should confirm.**
- **Art:** `holy_angel.png` (Lunaria) and `succubus.png` (Alecta) are in `C:\Users\diogo\Claude\assets\angels`, but they are detailed paintings and the game is pixel art. Two options: show the painting as a full-screen moment when the Angel arrives, or draw pixel sprites from it. Suggested: both, the painting for the arrival and a sprite for the turns that follow. The succubus file is 2.4 MB and needs shrinking for the web. Neither goes into the repository before this phase, and the repository is public.

## Open questions from the documents

- **Charisma's "Likes".** The notes say "Likes and social things". The manual reads this as sharing your work where people can respond to it, plus plain social contact. The owner should confirm what "likes" meant.
- **Tasks and the Finish school.** The manual says a task that took unusual effort goes in Finish, whatever its subject. This means a task's school now depends on effort for this one school and on subject for the other seven. Worth seeing how it plays.

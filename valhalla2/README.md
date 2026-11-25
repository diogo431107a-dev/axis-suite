# Valhalla 2

Companions you define, through the Claude API, who remember.

A fork of [Valhalla](../valhalla/README.md), kept apart from it while the two are compared: its own
folder, service, database, address and API key file. Nothing is shared between them, and nothing
moves from one to the other.

You write a companion in one text box: who they are, what they look like, how they behave, and who
_you_ are when you talk to them — before a queen you might be a cup-bearer; in a wolf pack, a wolf.
Then you talk. Every chat opens with their greeting, any reply can be written again as many times as
you like, and any message can be edited, deleted, branched from, copied or pinned.

It has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is
signed in there sees their own companions and chats and nobody else's.

|          |                                                                                       |
| -------- | ------------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind 4                                                          |
| Backend  | Express 5, the Claude API through `@anthropic-ai/sdk`                                 |
| Data     | SQLite (`node:sqlite`): `/var/lib/valhalla2/valhalla2.db` on a server, `data/` in dev |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                       |
| Address  | `https://valhalla2.<domain>`; https://localhost:8458 in WSL; port 5188 in `pnpm dev`  |

Like Valhalla and Fafnir, Valhalla 2 calls outside the suite: every message goes to
`api.anthropic.com`, on the server's API key, which whoever runs the suite pays for. Pictures, when
you ask for one, are made by CivitAI (`orchestration.civitai.com`) on the server's CivitAI key, which
pays in Buzz. Replies read aloud are read by Azure AI Speech (`<region>.tts.speech.microsoft.com`) on
the server's Azure key.

## Minimum interference

Valhalla 2 adds no content checks, no refusal wrapping, no warnings and no nagging of its own. You
are the one deciding what to send, and you are capable of that.

In practice that means:

- **The prompt is yours.** The system prompt is your companion's profile, exactly as you wrote it.
- **Valhalla 2's own words are few, and yours to rewrite.** A chat needs a little text you didn't
  write: the memory policy that comes with the companion's memory, the instruction that has it open
  the chat, the note that passes on why you rejected a reply, and the instructions the memory model
  works by. Each companion has its own copy of every one of them, which you can rewrite or leave on
  the default. The **Inspect** panel in a chat shows the exact request that goes out, built
  by the same code that sends it, with every hidden part marked.
- **Nothing is softened on the way back.** If the API declines a turn, that turn is stored and
  shown as a refusal, with the category and the explanation it gave, word for word.
- **Nothing is hidden on the way out.** A companion's settings are the whole request: model,
  effort, reply length, stop sequences, cache lifetime.

The one thing Valhalla 2 does on your behalf is ask the API for a fallback model when a turn is
declined (below). It is a checkbox, on by default, off whenever you want, and either way Valhalla 2
itself filters nothing.

## A chat is a tree

Every reply can be written again (a **swipe**), and every message can be **edited**, **deleted**, or
**branched from**: what you say next starts a new line from there. Nothing you haven't deleted is
thrown away. The versions you didn't pick and the branches you left stay in the chat, one click
away (‹ 2/3 ›), but only the selected path is "what happened": it is the only thing sent to the
model.

After the fifth swipe on the same reply, Valhalla 2 asks once why the versions aren't working. The
question can be skipped; an answer goes, hidden, with every later version of that reply, so it is
used straight away. (The number is `VALHALLA_SWIPE_ASK`, below.)

Each chat is **canon** (part of your story together) or a **one-shot** (a standalone scenario). You
choose when you open it, and can change it later; memory treats the two differently (below).

## Liking a reply

Swipes tell memory what didn't work; a like tells it what did. The heart under a companion's reply
likes it at once and opens a box asking what made it good. There is no dislike: a swipe, with its
reason, already is one.

- **With a comment**, the like is praise. The memory model reads it at its next run, beside the
  reasons you gave for rejecting replies, and keeps what it shows as "what to keep doing" in
  `feedback.md`, in general terms rather than as a quote. It never goes into the chat's own
  messages, so the next reply, the cache and the companion's earlier thinking are untouched; it
  reaches the companion when a chat next takes a fresh look at memory.
- **Without one**, the like is only for you: it is kept and shown, and nothing is sent anywhere.
- **It keeps the words you liked.** Edit the reply later and the praise is still about what it said
  then. The memory model also sees up to three of the reply's other versions, so it can tell what
  you chose over what. Liking a version you then swipe away is fine: the memory model is told it
  is not on the selected path, and takes the writing from it, never facts or events.
- **Taking it back.** Change the comment, remove it, unlike, or delete the reply, and the memory
  model is told what it was told before, so it can take back what came only from that.
- **It is not a pin.** The memory model rewrites praise in its own words. For words that must stay
  exactly as they were said, pin them.

The comment shows in small print under the reply; tap the heart again to change it or unlike.

## Memory

Every chat with a companion feeds one memory, so the companion stays the same person with a growing
history, without the old chats being sent again. It is a handful of Markdown files, which you can
read, edit and put back on the companion's **Memory** page:

| File                 | What it holds                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `character_canon.md` | what the character has established about herself beyond the profile: backstory, tastes, habits, scars   |
| `relationship.md`    | how the bond has changed, nicknames, inside jokes, rituals, promises, where things stand                |
| `user.md`            | the real person behind the persona: real-life facts only                                                |
| `feedback.md`        | standing requests about how the character writes or behaves, and patterns in rejected and liked replies |
| `open_threads.md`    | unresolved plot hooks, and real-life things to ask about later                                          |
| `world.md`           | places, recurring characters, owned items, lore                                                         |
| `story/recent.md`    | 3–6 line summaries of the latest canon chats                                                            |
| `story/arcs.md`      | older history, condensed into arcs                                                                      |

**Only the memory model writes it**, never a chat. A reply can be swiped away, edited, deleted or
left behind on another branch, so if replies wrote memory, a rejected one could leave invented
"facts" behind. Instead, a second model (each companion's _Memory model_, Sonnet 5.5 by default)
reads the chat's **selected path** afterwards and updates the files with the memory tool. It runs:

- when a chat has been quiet for 30 minutes (checked every minute, and once at startup);
- when you press **Remember now** in a chat;
- when a long chat's oldest turns slide out of what is sent (below);
- when you open a new chat with the companion, for its other chats: the greeting waits for it, so
  it is written knowing everything.

It gets what is new on the path, what was **edited, deleted or left on another branch** since it
last ran (with what replaced it, so it can take back what came only from that), and your reasons for
rejecting replies and your praise for liked ones; it folds a reason into `feedback.md` only when it
is a lasting preference. A
**one-shot** chat may not touch `world.md` or `story/`: its events aren't part of the story, but what
it shows about the two of you is kept. It works on a copy of the files, swapped in whole when it
finishes; a run that is declined, fails or runs out of steps changes nothing and is tried again
later. Each run is listed on the Memory page with what it changed and what it cost — a few cents on
Sonnet.

**Every chat reads all of it**, in its system prompt after the profile, so the companion never has
to look anything up mid-reply. The files are capped (8 KB each, 16 KB for the story files, 20
files), so that is a few thousand tokens, cached like the profile. A chat keeps the memory it
started with and looks again only when its prompt changes anyway — when its oldest turns slide out,
when its mode changes, or after it has sat longer than the cache lasts — because changing the
system prompt mid-chat would cost the cache and the companion's earlier thinking.

**Long chats slide.** Only about the last 20,000 tokens of the selected path are sent. When a chat
outgrows that, its oldest ten exchanges slide out at once — not one per turn, which would change the
start of the request, and so miss the cache, every turn. They are folded into memory first. A dashed
line in the chat marks where what is sent begins.

**Pinned moments.** The memory model writes in its own words, and tidy-ups condense, so the exact
wording of a promise or an origin line can drift. For words that must stay as they were said, the
pin under a message keeps them: you trim them to the line that matters and say who said them, and
every chat with the companion gets them word for word in a `<pinned_moments>` block after its
memory, under a short note (**Pinned moments note**, one of the companion's own texts). The memory
model never sees or changes them; a tidy-up or rebuild leaves them alone, and a deleted chat leaves
its pins behind. The chat you pinned from takes a fresh look at memory on its next turn — one turn
with a cold cache, as after a mode change — and other chats see the pin when they next look. Pins
are listed, and unpinned, on the Memory page; 30 at most, of 500 characters each, since every one
is sent every turn.

Every change to every file is kept, with where it came from (a chat, your edit, a revert). The
Memory page shows a file's history as a line-by-line diff, and **puts back** any earlier version as
one more change.

**Tidy-ups.** Filed a chat at a time, the files slowly gather near-duplicates and facts later chats
contradicted. After every ten consolidations — or after a week, if memory changed at all — the
memory model reads all the files at once and tidies them: merges duplicates, lets the most recent
fact win, and condenses each file toward about 70% of its limit. It never silently rewrites
`character_canon.md`: a real conflict there is listed under `## Conflicts` at the end of the file.
It may not add, rename or delete files; a tidy-up that tries is not kept. **Tidy up now** on the
Memory page runs one at once.

**Rebuilding.** **Rebuild from every chat** on the Memory page starts the files over from their
seeds and replays every chat's selected path through the memory model, in the order the chats were
held, a window's worth at a time — for when memory went wrong, a better memory model is out, or
you rewrote its instructions. The current files stay in place until it finishes and stay in each
file's history after; if any step fails, nothing changes.

## Pictures

A picture of the moment, or of the companion. Under any message, the picture button asks Claude
(`PICTURE_PROMPT_MODEL`, Sonnet 5.5) to read the profile and the last 20 messages of the path up to
that one, and write a prompt for the image model: who is there and what they look like, what they
are doing, the place, the light. Where the chat is vague, it invents. Nothing runs on ordinary
replies; a prompt costs a cent or two, and only when you ask.

The prompt opens in a dialog for you to change, with a note for Claude ("at sunset", "from
behind") if you want it written again. **Make the picture** sends it to CivitAI, which makes it on
the WAI-illustrious SDXL checkpoint (`PICTURE_MODEL`) at 30 steps and CFG 7, at a size SDXL was
trained on for the shape Claude chose. It takes a few seconds to a minute; the picture appears under
its message when it is done, only on that branch of the chat.

Each companion's **Pictures** page, from its own page, has two shelves: **Profile pictures**, made
there from the profile alone, and **Chat pictures**, each naming the chat it came from. Any picture
can be opened full size, made again from the same prompt with a new seed, or deleted. How Claude
writes the prompts is one of the companion's own texts, **Picture instructions**, which you can
rewrite like the others.

Pictures are files on the server's disk, read from there each time they are shown. A deleted chat
leaves its pictures in the gallery; a deleted companion takes its pictures with it. Without a
CivitAI key Valhalla 2 works as before and offers no new pictures.

## Reading aloud

A companion's replies can be read aloud, by Azure AI Speech's neural voices. For now every
companion is read by the same voice, Ava (`en-US-AvaMultilingualNeural`), which is multilingual: it
reads Portuguese, Spanish and most other languages too, telling them from the text.

- **As replies arrive.** The speaker switch in a chat's header (**Aloud** / **Silent**) says whether
  each new reply, version or greeting is read as soon as it is written. It is remembered by the
  browser, not the companion — on at home, off on the phone in public — and starts on.
- **On demand.** The speaker button under any reply reads it; while it plays it becomes a stop
  button. Starting one reply stops the other, and leaving the chat stops it.

The whole reply is read in one voice, actions too: the asterisks around them are dropped, not
spoken. A phone's browser may refuse to start sound the page didn't get a tap for; the speaker
button under the reply always works.

**Each reply is read once.** The first time it is asked for, Azure reads it and the MP3 is kept on
the server, about 0.4 MB a minute; playing it again is instant and costs nothing. An edited reply is
read again, and the old audio deleted. Under the composer, after the first reading in a visit, is how
many characters Azure has read this month for the whole server. Azure's free tier (F0) includes
500,000 characters a month; the paid tier (S0) bills per million characters. Everyone who can sign in
to Heimdall reads on the server's key.

Without an Azure key Valhalla 2 works as before and reads nothing aloud.

## When the API declines a turn

The current models run **Anthropic's safety classifiers** on every request. They are part of the
API, not of Valhalla 2, and they are separate from the model's own judgement. When one of them
flags a request, the API still answers with success, but with no reply (or a reply cut short) and a
**category** saying which area it flagged:

| Category               | What the classifier looks for                                       |
| ---------------------- | ------------------------------------------------------------------- |
| `cyber`                | help with cyber harm, such as malware or exploits                   |
| `bio`                  | help with biological harm, such as dangerous lab methods            |
| `frontier_llm`         | help building a competing AI model                                  |
| `reasoning_extraction` | asking the model to write out its hidden reasoning in the reply     |
| `general_harms`        | another area of Anthropic's Usage Policy (Sonnet 5.5 and Haiku 5.5) |

These are areas of the Usage Policy, but a decline is not a ruling that you broke it. A classifier
is a quick automatic check, and it also flags harmless text: a thriller villain's hacking scene, a
plague in a fantasy kingdom. Those mistakes are what the fallback is for. When the model itself
declines, rather than a classifier, the turn is shown the same way.

**What the checkbox does.** With _Let another model answer if this one declines_ ticked, Valhalla 2
asks for the API's `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). When a
classifier declines, the API runs the same request again, in the same call, on an older model that
Anthropic picks for that category and whose classifiers are set differently. If that model answers,
the answer is stored as the turn and marked as served by it. If it declines too, you get the
refusal as usual. It is not a way around the Usage Policy: the fallback model follows the same
policy and has safeguards of its own.

**It depends on the model you chose:**

| Model      | What the fallback does                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Haiku 5.5  | **Nothing.** The API has no fallback for Haiku: a declined turn stays declined.                                         |
| Sonnet 5.5 | Retries `cyber` and `frontier_llm` on Sonnet 5. `bio`, `general_harms` and `reasoning_extraction` stay declined.        |
| Opus 5.5   | Retries on the model Anthropic recommends for the category (Opus 5 or Opus 4.8). `reasoning_extraction` stays declined. |
| Fable 5.2  | Retries on Opus 5 or Opus 4.8.                                                                                          |

So in a Haiku chat the checkbox changes nothing; a declined turn there can only be written again or
said differently.

**What it costs and changes**, when it does run:

- The answer is billed at the fallback model's prices. A decline that came part-way through a reply
  is billed as normal too; whether one before any reply is billed depends on its category.
- For about an hour afterwards, the API sends the same chat straight to the fallback model, without
  trying yours first. Each reply records the model that wrote it, and says so under it.
- The fallback model cannot read the earlier replies' thinking, only what was said, so the
  companion's voice can shift a little. Nothing is lost: the thinking is kept, and is read again
  when the chat is back on your model.

## Running it

From the suite's root, with Heimdall running beside it (`pnpm dev` starts every module):

```bash
pnpm install
pnpm --filter heimdall --filter valhalla2 dev
```

Then open http://127.0.0.1:5188 and sign in as one of the demo accounts. The API runs on
127.0.0.1:3016 and the page talks to it through Vite's proxy.

**The API key never goes in `dev.env`.** That file is committed, and the repository is public. Put
it in `data/secret.env`, which git ignores and the installer never copies:

```bash
echo 'ANTHROPIC_API_KEY=<your key>' > valhalla2/data/secret.env
```

For pictures, add the CivitAI key on a line of its own in the same file:

```bash
echo 'CIVITAI_API_KEY=<your key>' >> valhalla2/data/secret.env
```

To read aloud, add the Azure Speech key the same way (its region is `SPEECH_REGION` in `dev.env`):

```bash
echo 'SPEECH_KEY=<your key>' >> valhalla2/data/secret.env
```

If you have signed in with `ant auth login` instead, leave it out: the SDK finds that profile by
itself. The key is read by the server process and never reaches the browser.

```bash
pnpm --filter valhalla2 test    # none of the tests calls the real API
pnpm --filter valhalla2 smoke   # one real chat, then its memory, against the API. A few cents.
```

## Settings

Set in `dev.env` for development and in `deploy/valhalla2.service` on a server. Every one has a
default.

| Variable                     | Default                                          | What it does                                                      |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `CHAT_MODEL`                 | `claude-opus-5-5`                                | The model a new companion answers with. Each can change it.       |
| `MEMORY_MODEL`               | `claude-sonnet-5-5`                              | The model a new companion keeps its memory with. Each can change. |
| `VALHALLA_SWIPE_ASK`         | `5`                                              | Swipes on one reply before asking why they aren't working.        |
| `VALHALLA_WINDOW_TOKENS`     | `20000`                                          | About how many tokens of a chat are sent each turn.               |
| `VALHALLA_WINDOW_CHUNK`      | `10`                                             | How many exchanges slide out at once when a chat outgrows that.   |
| `VALHALLA_IDLE_MINUTES`      | `30`                                             | How long a chat is quiet before it is folded into memory.         |
| `VALHALLA_MEMORY_FILE_KB`    | `8`                                              | The largest a memory file may be.                                 |
| `VALHALLA_MEMORY_STORY_KB`   | `16`                                             | The largest `story/recent.md` and `story/arcs.md` may be.         |
| `VALHALLA_MEMORY_FILES`      | `20`                                             | How many memory files a companion may have.                       |
| `VALHALLA_MEMORY_ITERATIONS` | `16`                                             | The most requests one run of the memory model may make.           |
| `VALHALLA_CLEANUP_EVERY`     | `10`                                             | Consolidations between two tidy-ups of a companion's memory.      |
| `VALHALLA_CLEANUP_DAYS`      | `7`                                              | …or days, if memory changed at all in that time.                  |
| `VALHALLA_BACKUPS_KEPT`      | `14`                                             | How many daily backups of the database are kept.                  |
| `PICTURE_MODEL`              | `urn:air:sdxl:checkpoint:civitai:827184@2883731` | The CivitAI model that makes pictures, as an AIR.                 |
| `PICTURE_PROMPT_MODEL`       | `claude-sonnet-5-5`                              | The model that writes a picture's prompt.                         |
| `VALHALLA_PICTURE_MESSAGES`  | `20`                                             | How many messages it reads, up to the one being pictured.         |
| `SPEECH_REGION`              | `brazilsouth`                                    | The Azure region of the Speech resource the key belongs to.       |
| `SPEECH_VOICE`               | `en-US-AvaMultilingualNeural`                    | The voice that reads replies aloud.                               |

The unit file sets both models to Haiku 5.5 and Sonnet 5.5.

## Where everything is kept

One SQLite file, `valhalla2.db`, in `/var/lib/valhalla2` on a server (`data/` in development). Every
companion belongs to a Heimdall username, and a chat and its messages belong to a companion. When
someone is removed from Heimdall, everything of theirs is deleted the next time Valhalla 2 starts.

A message is stored exactly as the API returned it, thinking blocks included. A delete only marks
it deleted, and an edit keeps the earlier words beside the new ones. A companion's memory files,
every version of them, every run of the memory model and every command it made are in the same
file, and go with the companion when it is deleted.

Pictures are files beside it, in `pictures/` (`/var/lib/private/valhalla2/pictures` on a server),
one per picture; the database says whose each one is and how it was made. Replies read aloud are MP3
files in `speech/` beside them, one per reply. Files nothing refers to any more are deleted when
Valhalla 2 starts.

## Things the current API decides, not Valhalla 2

These surprise people coming from other companion apps. They are not choices made here; ignoring
them produces errors.

- **There is no temperature.** `temperature`, `top_p` and `top_k` are rejected by the current
  models. `effort` is the dial that replaced them: `low` for dialogue, higher when you want the
  model to think before it speaks.
- **The first message must be yours.** The API takes no conversation that starts with the
  companion. So a greeting answers a fixed, hidden first message — `[The chat begins.]` — followed by
  the greeting instruction. Both are stored with the greeting and sent again, unchanged, on every
  later turn; Inspect shows them.
- **Thinking is bound to the conversation.** The API ties each piece of the model's thinking to the
  exact conversation before it. An edit or a delete changes that conversation, so every request asks
  the API to drop the thinking that no longer matches (beta `thinking-binding-controls-2026-08-01`)
  instead of refusing it. The replies after an edit are written without that earlier reasoning,
  and the cache starts again from the edit.
- **A refusal is an answer**, delivered successfully with a category attached, not an error. It is
  kept, but it is not sent back: the API takes no empty reply mid-conversation. Your message
  before it is left out too, so the model never sees the exchange.
- **The prompt cache needs a minimum length** (512 tokens or more, depending on the model). A
  two-line profile will silently never cache. Watch `cached` under the composer: it should climb
  turn after turn. If it stays at zero on a long chat, something in the prompt is changing between
  requests.

## Cost

Each turn re-sends the selected path, up to the window. The prompt cache is what makes that affordable: on
Claude Opus 5.5 input is $4.00 per million tokens and a cache read is $0.20 — everything already
said costs a twentieth to send again. Valhalla 2 puts a breakpoint at the end of the system prompt
and another that follows the chat as it grows, and shows what each reply cost at the published
prices: a cache write at 1.25 times the input price for 5 minutes and twice for an hour, every
model that tried a declined turn added up. It is an estimate; the Claude Console has the bill.

The cache keeps a chat for 5 minutes or an hour, your choice per companion. An hour is the default
because people pause, and a cold cache costs twenty times a warm one.

## Not here yet

- **Scenes** — the frame a chat sits in, reusable across companions.

## How it is built

One module holding both halves, like the rest of the suite.

|                        |                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/protocol.ts`   | the wire format, the limits, the models and their prices; one file per area in `shared/protocol/` (`limits.ts`, `models.ts`, `companions.ts`, `chat.ts`, `memory.ts`, `pictures.ts`, `api.ts`), all re-exported here                                                     |
| `shared/prompts.ts`    | Valhalla 2's own words and their defaults                                                                                                                                                                                                                                |
| `shared/sse.ts`        | how a reply travels while it is being written, and how it is read                                                                                                                                                                                                        |
| `server/index.ts`      | the database, the services, the routers and sign-in, put together                                                                                                                                                                                                        |
| `server/services.ts`   | everything the routes use, made once; `startup.ts` is the one-off work at boot                                                                                                                                                                                           |
| `server/routes/`       | the API, one router per area: `meta.ts`, `companions.ts`, `chats.ts`, `messages.ts`, `memory.ts`, `pictures.ts`, `speech.ts`                                                                                                                                             |
| `server/http/`         | a reply as it streams (`stream.ts`), a kept file sent to its owner (`sendStored.ts`), errors as JSON (`errors.ts`)                                                                                                                                                       |
| `server/db.ts`         | the database, its migrations, transactions, removed users                                                                                                                                                                                                                |
| `server/companions.ts` | companions                                                                                                                                                                                                                                                               |
| `server/chat/`         | chats (`chats.ts`), the message tree (`tree.ts`), asking for replies (`turn.ts`)                                                                                                                                                                                         |
| `server/memory/`       | memory: paths, files and versions (`store.ts`), the memory tool (`tool.ts`), what a chat sees (`inject.ts`), the window (`history.ts`), consolidation, tidy-ups and rebuilds (`consolidate.ts`, `cleanup.ts`, `rebuild.ts`, `run.ts`) and when they run (`scheduler.ts`) |
| `server/prompt.ts`     | the system prompt and the messages. Deterministic, or the cache never hits                                                                                                                                                                                               |
| `server/pins.ts`       | pinned moments: kept word for word, sent after memory, and the chats that must look again                                                                                                                                                                                |
| `server/likes.ts`      | liked replies: the words as they were liked, and the praise memory hasn't heard of yet, or must take back                                                                                                                                                                |
| `server/backup.ts`     | the daily backups                                                                                                                                                                                                                                                        |
| `server/key.ts`        | where the API key comes from: the systemd credential, or the env                                                                                                                                                                                                         |
| `server/files.ts`      | the folders of kept files, pictures and audio, written whole and swept of strays                                                                                                                                                                                         |
| `server/speech/`       | reading aloud: started in `feature.ts`, the only file that talks to Azure (`azure.ts`), what is read (`text.ts`), its key (`key.ts`), and the kept audio (`store.ts`)                                                                                                    |
| `server/pictures/`     | pictures: started in `feature.ts`, the only file that talks to CivitAI (`civitai.ts`), its key (`key.ts`), what Claude reads to picture a scene (`scene.ts`), the rows (`store.ts`), and making them in the background (`painter.ts`)                                    |
| `server/claude/`       | the only folder that talks to the Claude API: the client and its errors (`client.ts`), chat replies (`reply.ts`), memory runs (`memory.ts`), picture prompts (`pictures.ts`), counting (`tokens.ts`)                                                                     |
| `server/busy.ts`       | one reply at a time per chat                                                                                                                                                                                                                                             |
| `web/`                 | React, Vite and Tailwind; `useState` and one context, no router. The chat page is `views/chat/` (its state in `useChat.ts`), the memory page `views/memory/`; pieces any page uses are in `ui/`                                                                          |
| `deploy/`              | the systemd unit (sandboxed, with the key) and the Caddy site                                                                                                                                                                                                            |

**Adding a feature** touches one file or folder per layer: its types in `shared/protocol/`, its
code in its own folder under `server/` (with a `feature.ts` if it is optional and needs a key,
returning null without one), its router in `server/routes/` with one line in `services.ts` and
`index.ts`, and its page or pieces under `web/`.

Tests sit beside the code as `<name>.test.ts` and none of them calls the real API — replies come
from a scripted writer, and the refusal and fallback paths are driven through synthetic replies.
`pnpm smoke` is the one thing that spends money, and you run it by hand.

## Installing and data

Install it like every module (see the [suite README](../README.md#installing-on-a-server)), with one
step before the first install: **put the Claude API key on the server.** systemd hands it to the
service as a credential, readable by nobody else, and refuses to start Valhalla 2 while it is missing.
Typed in, it stays out of the shell's history:

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla2-anthropic.key && unset KEY
sudo bash deploy/install.sh valhalla2
```

To change the key, run the first line again, then `sudo systemctl restart valhalla2`. It is not named
`valhalla2.key` on purpose: for that name the installer would write a random key of its own.

**The CivitAI key goes beside it, the same way**, and has to exist before the service starts, even
if it is empty (an empty file means no pictures):

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla2-civitai.key && unset KEY
```

**So does the Azure Speech key**, which reads replies aloud; again an empty file means none. Its
region is `SPEECH_REGION` in `deploy/valhalla2.service` (`brazilsouth`): a key from a resource in
another region needs that line changed too.

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla2-speech.key && unset KEY
```

Everyone who can sign in to Heimdall can talk to companions on this key, so give the suite a key of
its own and set a monthly spend limit for it in the Claude Console.

Valhalla 2 backs its database up by itself once a day, while it runs, into
`/var/lib/private/valhalla2/backups/valhalla2-YYYY-MM-DD.db` (systemd keeps `/var/lib/valhalla2`
there), and keeps the newest 14. **Back up now** on any Memory page makes today's at once. They are
made with SQLite's `VACUUM INTO`, which writes a consistent copy without stopping anything; never
copy the live `.db` file itself.

Those copies sit on the same disk as the database: they guard against a bad change or a broken
memory, not a lost disk. They hold everyone's private chats, so copy them elsewhere where only you
can read them:

```
sudo install -m 600 -o "$USER" /var/lib/private/valhalla2/backups/valhalla2-$(date +%F).db ~/
```

**The daily backups don't hold the pictures** (nor the audio, which is simply read again when it is
missing), only the database that lists them. To keep them,
copy the folder elsewhere now and then:

```
sudo tar -czf ~/valhalla2-pictures-$(date +%F).tar.gz -C /var/lib/private/valhalla2 pictures && sudo chown "$USER" ~/valhalla2-pictures-*.tar.gz
```

To go back to one: stop the service, put the copy in place of `valhalla2.db`, start it again.

```
sudo systemctl stop valhalla2
sudo install -m 600 /var/lib/private/valhalla2/backups/valhalla2-<day>.db /var/lib/private/valhalla2/valhalla2.db
sudo systemctl start valhalla2
```

## Where this differs from the memory brief

Valhalla 2's memory was built from a written brief. Where it does something else, this is why:

- **Chats don't get the memory tool; they get all of memory in the prompt.** The brief had chats
  look up `world.md` and `story/` with the tool. A tool loop inside a streamed reply mixes with
  declined turns, fallback models and the companion's thinking, every tool call would have to be
  stored and replayed exactly, and a low-effort Haiku may simply not look. The caps keep the whole
  memory to a few thousand cached tokens, so it is all sent. The memory tool is used where it
  matters: by the memory model.
- **Memory is frozen per chat** instead of rebuilt every turn, so the cache and the companion's
  thinking survive (see Memory).
- **A run works on a copy** that is swapped in whole, instead of committing each command, so a run
  cut short leaves nothing half-done. Each command still writes one version, kept when the run
  succeeds.
- **TypeScript, `node:sqlite`, Vitest and the default journal**, like the rest of the suite, instead
  of plain JavaScript, `better-sqlite3`, `node:test` and WAL.
- **Settings are per companion**, as before, with the two models in them; the environment only
  gives a new companion its defaults.
- **Stop sequences apply to chats only.** The memory model writes Markdown, which may well contain
  one.
- **Several people can use it**, each with their own companions, as everything in the suite does.
- **A tidy-up keeps the files as they are** and is thrown away if it adds, renames or deletes one,
  so "keep the file structure" is checked, not only asked for.
- **A rebuild reads long chats a window at a time**, and its intermediate steps aren't kept as
  versions: the history shows one `rebuild` change per file, beside everything before it.
- **Backups are checked for once an hour** rather than at a set time of day, so a server that was
  off at that time still gets its daily copy; "Installing and data" says how to go back to one.

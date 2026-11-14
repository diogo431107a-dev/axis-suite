# Valhalla 2

Companions you define, through the Claude API, who remember.

A fork of [Valhalla](../valhalla/README.md), kept apart from it while the two are compared: its own
folder, service, database, address and API key file. Nothing is shared between them, and nothing
moves from one to the other.

You write a companion in one text box: who they are, what they look like, how they behave, and who
_you_ are when you talk to them — before a queen you might be a cup-bearer; in a wolf pack, a wolf.
Then you talk. Every chat opens with their greeting, any reply can be written again as many times as
you like, and any message can be edited, deleted or branched from.

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
`api.anthropic.com`, on the server's API key, which whoever runs the suite pays for.

## Minimum interference

Valhalla 2 adds no content checks, no refusal wrapping, no warnings and no nagging of its own. You
are the one deciding what to send, and you are capable of that.

In practice that means:

- **The prompt is yours.** The system prompt is your companion's profile, exactly as you wrote it.
- **Valhalla 2's own words are few, and yours to rewrite.** A chat needs a little text you didn't
  write: the instruction that has the companion open the chat, and the note that passes on why you
  rejected a reply. Each companion has its own copy of every one of them, which you can rewrite or
  leave on the default. The **Inspect** panel in a chat shows the exact request that goes out, built
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
choose when you open it, and can change it later. Today the mode is a label; the companion's memory,
which is being built, is what will treat the two differently.

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

If you have signed in with `ant auth login` instead, leave it out: the SDK finds that profile by
itself. The key is read by the server process and never reaches the browser.

```bash
pnpm --filter valhalla2 test    # none of the tests calls the real API
pnpm --filter valhalla2 smoke   # one real chat against the API. Spends a fraction of a cent.
```

## Settings

Set in `dev.env` for development and in `deploy/valhalla2.service` on a server. Every one has a
default.

| Variable             | Default             | What it does                                                      |
| -------------------- | ------------------- | ----------------------------------------------------------------- |
| `CHAT_MODEL`         | `claude-opus-5-5`   | The model a new companion answers with. Each can change it.       |
| `MEMORY_MODEL`       | `claude-sonnet-5-5` | The model a new companion keeps its memory with. Each can change. |
| `VALHALLA_SWIPE_ASK` | `5`                 | Swipes on one reply before asking why they aren't working.        |

The unit file sets both models to Haiku 5.5 and Sonnet 5.5.

## Where everything is kept

One SQLite file, `valhalla2.db`, in `/var/lib/valhalla2` on a server (`data/` in development). Every
companion belongs to a Heimdall username, and a chat and its messages belong to a companion. When
someone is removed from Heimdall, everything of theirs is deleted the next time Valhalla 2 starts.

A message is stored exactly as the API returned it, thinking blocks included. A delete only marks
it deleted, and an edit keeps the earlier words beside the new ones.

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

Each turn re-sends the whole selected path. The prompt cache is what makes that affordable: on
Claude Opus 5.5 input is $4.00 per million tokens and a cache read is $0.20 — everything already
said costs a twentieth to send again. Valhalla 2 puts a breakpoint at the end of the system prompt
and another that follows the chat as it grows, and shows what each reply cost at the published
prices: a cache write at 1.25 times the input price for 5 minutes and twice for an hour, every
model that tried a declined turn added up. It is an estimate; the Claude Console has the bill.

The cache keeps a chat for 5 minutes or an hour, your choice per companion. An hour is the default
because people pause, and a cold cache costs twenty times a warm one.

## Not here yet

- **Long-term memory** — every chat feeding one organized memory per companion. Being built.
- **Scenes** — the frame a chat sits in, reusable across companions.
- **Images** — appearance is text that feeds the prompt.

## How it is built

One module holding both halves, like the rest of the suite.

|                        |                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------- |
| `shared/protocol.ts`   | the wire format, the limits, the models and their prices                         |
| `shared/prompts.ts`    | Valhalla 2's own words and their defaults                                        |
| `shared/sse.ts`        | how a reply travels while it is being written, and how it is read                |
| `server/db.ts`         | the database, its migrations, transactions, removed users                        |
| `server/companions.ts` | companions                                                                       |
| `server/chat/`         | chats (`chats.ts`), the message tree (`tree.ts`), asking for replies (`turn.ts`) |
| `server/prompt.ts`     | the system prompt and the messages. Deterministic, or the cache never hits       |
| `server/key.ts`        | where the API key comes from: the systemd credential, or the env                 |
| `server/claude.ts`     | the only file that talks to the Claude API                                       |
| `server/busy.ts`       | one reply at a time per chat                                                     |
| `server/index.ts`      | the routes and sign-in                                                           |
| `web/`                 | React, Vite and Tailwind; `useState` and one context, no router                  |
| `deploy/`              | the systemd unit (sandboxed, with the key) and the Caddy site                    |

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

Everyone who can sign in to Heimdall can talk to companions on this key, so give the suite a key of
its own and set a monthly spend limit for it in the Claude Console.

A backup is the database file. It holds everyone's private chats, so keep backups where only you
can read them, taken with the service stopped (`/var/lib/private/valhalla2` is where systemd really
keeps it):

```
sudo systemctl stop valhalla2
sudo cp /var/lib/private/valhalla2/valhalla2.db ~/valhalla2-backup-$(date +%Y%m%d).db
sudo systemctl start valhalla2
sudo chown "$USER": ~/valhalla2-backup-*.db && chmod 600 ~/valhalla2-backup-*.db
```

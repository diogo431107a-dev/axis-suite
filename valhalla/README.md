# Valhalla

Companions you define, through the Claude API.

You write a character — their personality, their appearance, how they behave. You write who _you_
are when you speak to them: before a king you might be a servant; in a wolf pack, a wolf. Then you
talk. One character can be met by any of your personas, and one persona can be used with any
character.

It runs on your own machine, for you alone, and everything it keeps is a plain file you can open.

## Minimum interference

Valhalla adds no content checks, no refusal wrapping, no warnings and no nagging of its own. You
are the one deciding what to send, and you are capable of that.

In practice that means:

- **The prompt is yours.** Valhalla contributes two headings and nothing else. Every sentence the
  model reads about who it is came from a field you filled in. The **Inspect** panel in a
  conversation shows the exact blocks that go out, built by the same code that sends them.
- **Nothing is softened on the way back.** If the API declines a turn, that turn is stored and
  shown as a refusal, with the category and the explanation it gave, word for word.
- **Nothing is hidden on the way out.** The settings panel is the whole request: model, effort,
  reply length, stop sequences, cache lifetime.

The one thing Valhalla does on your behalf is ask the API for a fallback model when a turn is
declined, so a scene need not dead-end. It is a checkbox, it is off whenever you want, and either
way Valhalla itself filters nothing.

## Running it

```bash
pnpm install
cp dev.env.example dev.env   # then put your key in it
pnpm dev
```

Then open http://127.0.0.1:5200. The API runs beside it on 127.0.0.1:3100 and the page talks to it
through Vite's proxy.

Your key is read by the server process and never reaches the browser. If you have signed in with
`ant auth login` instead, leave the key out — the SDK finds that profile by itself.

```bash
pnpm check    # formatting, lint, types, tests
pnpm build    # dist/ — the API compiled, and the page
pnpm start    # the built API, serving on 127.0.0.1:3100
pnpm smoke    # one real conversation against the API. Spends a fraction of a cent.
```

## Where everything is kept

```
data/
  characters/<id>.json
  personas/<id>.json
  conversations/<id>/conversation.json    who is talking to whom, and the settings
  conversations/<id>/turns.jsonl          the dialogue, one turn per line
```

Open them, edit them, copy the folder to back it up. A write lands whole or not at all, and a log
cut short by a crash loses only the unfinished line.

The turn log is **append-only**, and that is not a storage preference. Thinking blocks the API
returns are bound to the model and to the conversation that produced them, so a turn that has been
sent has to go back exactly as it came. Changing the past is a fork, not an edit — which is why
there is no reroll yet (see below).

## Things the current API decides, not Valhalla

These surprise people coming from other companion apps. They are not choices made here; ignoring
them produces errors.

- **There is no temperature.** `temperature`, `top_p` and `top_k` are rejected by the current
  models. `effort` is the dial that replaced them: `low` for dialogue, higher when you want the
  model to think before it speaks.
- **You speak first.** The first message in a conversation must be yours, so a character has no
  opening line. Faking one would mean instructing the model in the system prompt — exactly the
  interference Valhalla avoids.
- **A refusal is an answer**, delivered successfully with a category attached, not an error.
- **The prompt cache needs 512 tokens.** A two-line character will silently never cache. Watch
  `cached` under the composer: it should climb turn after turn. If it stays at zero on a long
  conversation, something in the prompt is changing between requests.

## Cost

Each turn re-sends the whole conversation. The prompt cache is what makes that affordable: on
Claude Opus 5.5 input is $4.00 per million tokens and a cache read is $0.20 — everything already
said costs a twentieth to send again. Valhalla puts a breakpoint at the end of the system prompt
and another that follows the conversation as it grows, and shows you what each turn actually cost.

The cache keeps a conversation for 5 minutes or an hour, your choice per conversation. An hour is
the default because people pause, and a cold cache costs twenty times a warm one.

## Not here yet

Each of these is a real feature with a reason to wait, not an oversight.

- **Scenes** — the frame a conversation sits in, reusable across pairs.
- **Director notes** — an out-of-character instruction mid-scene. The mechanism exists and does
  not break the cache; it is still a feature to build properly.
- **Branching and reroll** — a fork of the conversation from any turn. The append-only rule above
  makes this the only correct shape for it, and it deserves doing properly.
- **Images** — appearance is text that feeds the prompt.
- **Accounts, deploy, more than one person** — it listens on 127.0.0.1 and serves you.

## How it is built

One package holding both halves, in the style of the `axis-suite` modules next door.

|                      |                                                                   |
| -------------------- | ----------------------------------------------------------------- |
| `shared/protocol.ts` | the wire format, the limits, the models and their prices          |
| `shared/sse.ts`      | how a reply travels while it is being written, and how it is read |
| `server/files.ts`    | atomic writes, one queue per file, a log that survives a crash    |
| `server/store.ts`    | characters and personas                                           |
| `server/log.ts`      | conversations and their append-only turn log                      |
| `server/prompt.ts`   | the system prompt. Deterministic, or the cache never hits         |
| `server/claude.ts`   | the only file that talks to the Claude API                        |
| `server/index.ts`    | the routes                                                        |
| `web/`               | React, Vite and Tailwind; `useState` and one context, no router   |

Tests sit beside the code as `<name>.test.ts` and none of them calls the real API — including the
refusal and fallback paths, which are driven through synthetic replies. `pnpm smoke` is the one
thing that spends money, and you run it by hand.

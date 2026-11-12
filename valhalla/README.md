# Valhalla

Companions you define, through the Claude API.

You write a character — their personality, their appearance, how they behave. You write who _you_
are when you speak to them: before a king you might be a servant; in a wolf pack, a wolf. Then you
talk. One character can be met by any of your personas, and one persona can be used with any
character.

It has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is
signed in there sees their own characters, personas and conversations and nobody else's. Everything it
keeps is a plain file you can open.

|          |                                                                                      |
| -------- | ------------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, Tailwind 4                                                         |
| Backend  | Express 5, the Claude API through `@anthropic-ai/sdk`                                |
| Data     | plain files: `/var/lib/valhalla/users/<username>/` on a server, `data/users/` in dev |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                      |
| Address  | `https://valhalla.<domain>`; https://localhost:8457 in WSL; port 5187 in `pnpm dev`  |

Valhalla is the one module besides Fafnir that calls outside the suite: every message goes to
`api.anthropic.com`, on the server's API key, which whoever runs the suite pays for.

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
declined (below). It is a checkbox, on by default, off whenever you want, and either way Valhalla
itself filters nothing.

## When the API declines a turn

The current models run **Anthropic's safety classifiers** on every request. They are part of the
API, not of Valhalla, and they are separate from the model's own judgement. When one of them
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

**What the checkbox does.** With _Let another model answer if this one declines_ ticked, Valhalla
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

So in a Haiku conversation the checkbox changes nothing; a declined turn there can only be written
differently and sent again.

**What it costs and changes**, when it does run:

- The answer is billed at the fallback model's prices. A decline that came part-way through a reply
  is billed as normal too; whether one before any reply is billed depends on its category.
- For about an hour afterwards, the API sends the same conversation straight to the fallback model,
  without trying yours first. Each turn records the model that wrote it, and says so under it.
- The fallback model cannot read the earlier turns' thinking, only what was said, so the
  character's voice can shift a little. Nothing is lost: the thinking is kept, and is read again
  when the conversation is back on your model.

## Running it

From the suite's root, with Heimdall running beside it (`pnpm dev` starts every module):

```bash
pnpm install
pnpm --filter heimdall --filter valhalla dev
```

Then open http://127.0.0.1:5187 and sign in as one of the demo accounts. The API runs on
127.0.0.1:3015 and the page talks to it through Vite's proxy.

**The API key never goes in `dev.env`.** That file is committed, and the repository is public. Put
it in `data/secret.env`, which git ignores and the installer never copies:

```bash
echo 'ANTHROPIC_API_KEY=<your key>' > valhalla/data/secret.env
```

If you have signed in with `ant auth login` instead, leave it out: the SDK finds that profile by
itself. The key is read by the server process and never reaches the browser.

```bash
pnpm --filter valhalla test    # none of the tests calls the real API
pnpm --filter valhalla smoke   # one real conversation against the API. Spends a fraction of a cent.
```

## Where everything is kept

Each person has a folder of their own, named after their Heimdall username:

```
/var/lib/valhalla/users/<username>/       (data/users/<username>/ in development)
  characters/<id>.json
  personas/<id>.json
  conversations/<id>/conversation.json    who is talking to whom, and the settings
  conversations/<id>/turns.jsonl          the dialogue, one turn per line
```

Open them, edit them, copy the folder to back it up. When someone is removed from Heimdall, their
folder is deleted the next time Valhalla starts. A write lands whole or not at all, and a log
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
- **A refusal is an answer**, delivered successfully with a category attached, not an error. It is
  kept, but it is not sent back: the API takes no empty reply mid-conversation. Your message
  before it is left out too, so the model never sees the exchange.
- **The prompt cache needs 512 tokens.** A two-line character will silently never cache. Watch
  `cached` under the composer: it should climb turn after turn. If it stays at zero on a long
  conversation, something in the prompt is changing between requests.

## Cost

Each turn re-sends the whole conversation. The prompt cache is what makes that affordable: on
Claude Opus 5.5 input is $4.00 per million tokens and a cache read is $0.20 — everything already
said costs a twentieth to send again. Valhalla puts a breakpoint at the end of the system prompt
and another that follows the conversation as it grows, and shows what each turn cost at the
published prices: a cache write at 1.25 times the input price for 5 minutes and twice for an hour,
every model that tried a declined turn added up. It is an estimate; the Claude Console has the bill.

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

## How it is built

One module holding both halves, like the rest of the suite.

|                      |                                                                   |
| -------------------- | ----------------------------------------------------------------- |
| `shared/protocol.ts` | the wire format, the limits, the models and their prices          |
| `shared/sse.ts`      | how a reply travels while it is being written, and how it is read |
| `server/users.ts`    | whose folder is whose, and removing the folders of removed users  |
| `server/files.ts`    | atomic writes, one queue per file, a log that survives a crash    |
| `server/store.ts`    | characters and personas                                           |
| `server/log.ts`      | conversations and their append-only turn log                      |
| `server/prompt.ts`   | the system prompt. Deterministic, or the cache never hits         |
| `server/key.ts`      | where the API key comes from: the systemd credential, or the env  |
| `server/claude.ts`   | the only file that talks to the Claude API                        |
| `server/busy.ts`     | one reply at a time per conversation                              |
| `server/index.ts`    | the routes, sign-in, and removed users' folders                   |
| `web/`               | React, Vite and Tailwind; `useState` and one context, no router   |
| `deploy/`            | the systemd unit (sandboxed, with the key) and the Caddy site     |

Tests sit beside the code as `<name>.test.ts` and none of them calls the real API — including the
refusal and fallback paths, which are driven through synthetic replies. `pnpm smoke` is the one
thing that spends money, and you run it by hand.

## Installing and data

Install it like every module (see the [suite README](../README.md#installing-on-a-server)), with one
step before the first install: **put the Claude API key on the server.** systemd hands it to the
service as a credential, readable by nobody else, and refuses to start Valhalla while it is missing.
Typed in, it stays out of the shell's history:

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla-anthropic.key && unset KEY
sudo bash deploy/install.sh valhalla
```

To change the key, run the first line again, then `sudo systemctl restart valhalla`. It is not named
`valhalla.key` on purpose: for that name the installer would write a random key of its own.

Everyone who can sign in to Heimdall can talk to companions on this key, so give the suite a key of
its own and set a monthly spend limit for it in the Claude Console.

A backup is the whole folder. It holds everyone's private conversations, so keep backups where only
you can read them, taken with the service stopped (`/var/lib/private/valhalla` is where systemd
really keeps it):

```
sudo systemctl stop valhalla
sudo tar -czf ~/valhalla-backup-$(date +%Y%m%d).tar.gz -C /var/lib/private valhalla
sudo systemctl start valhalla
sudo chown "$USER": ~/valhalla-backup-*.tar.gz && chmod 600 ~/valhalla-backup-*.tar.gz
```

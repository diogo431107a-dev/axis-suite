# Valhalla 2

Companions you define, through the Claude API, the xAI API on Grok or the OpenAI API on GPT, who
remember — or, created that way, who don't.

It began as a fork of Valhalla, an earlier companions module that was compared with it and then
retired from the suite (2026-11-25). Nothing of Valhalla's was carried over.

You write a companion in one text box: who they are, what they look like, how they behave, and who
_you_ are when you talk to them — before a queen you might be a cup-bearer; in a wolf pack, a wolf.
Then you talk. Every chat opens with their greeting, any reply can be written again as many times as
you like, and any message can be edited, deleted, branched from, copied or pinned.

It has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is
signed in there sees their own companions and chats and nobody else's.

|          |                                                                                            |
| -------- | ------------------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, Tailwind 4                                                               |
| Backend  | Express 5, the Claude API through `@anthropic-ai/sdk`, xAI's and OpenAI's through `openai` |
| Data     | SQLite (`node:sqlite`): `/var/lib/valhalla2/valhalla2.db` on a server, `data/` in dev      |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                            |
| Address  | `https://valhalla2.<domain>`; https://localhost:8458 in WSL; port 5188 in `pnpm dev`       |

Like Fafnir, Valhalla 2 calls outside the suite: every message goes to
`api.anthropic.com`, on the server's API key, which whoever runs the suite pays for; everything a
Grok companion asks goes to `api.x.ai` instead, on the server's xAI key, and never to Anthropic;
everything a GPT companion asks goes to `api.openai.com`, on the server's OpenAI key, and nowhere
else. Pictures, when
you ask for one, are made by CivitAI (`orchestration.civitai.com`) on the server's CivitAI key, which
pays in Buzz, or, for a companion that chose Grok Imagine, by xAI's image model (`api.x.ai`) on the
server's xAI key, or, for one that chose OpenAI, by OpenAI's image model (`api.openai.com`) on the
server's OpenAI key. Replies read aloud are read by Azure AI Speech (`<region>.tts.speech.microsoft.com`) on
the server's Azure key, or, for a companion that chose one of Grok's voices, by xAI's text to speech
(`api.x.ai`) on the server's xAI key.

## Minimum interference

Valhalla 2 adds no content checks, no refusal wrapping, no warnings and no nagging of its own. You
are the one deciding what to send, and you are capable of that. The system prompt is your profile as
you wrote it; the few words Valhalla 2 adds are each companion's to rewrite; **Inspect** shows every
request exactly as it goes out; and a declined turn is shown word for word. The one thing done on
your behalf is asking for a fallback model when a turn is declined, a checkbox that is on by
default. See [Chats](docs/chats.md#what-valhalla-2-adds-to-a-request).

## What it does

- **A chat is a tree.** Any reply can be written again (a swipe), and any message edited, deleted
  or branched from; only the selected path counts as what happened. After the fifth swipe on a
  reply, Valhalla 2 asks once why the versions aren't working. A heart likes a reply, and a comment
  on it tells memory what to keep doing. See [Chats](docs/chats.md).
- **Canon or one-shot.** Each chat is part of your story together or a standalone scenario whose
  events stay out of it. See [How memory works](docs/memory.md#canon-and-one-shot).
- **Memory.** Every chat with a Claude companion feeds one memory: a handful of Markdown files a
  second model keeps up to date after each chat, which every chat reads whole. You can read, edit
  and put back the files, pin exact words, and list topics to leave alone, on the companion's
  **Memory** page. See [How memory works](docs/memory.md).
- **Claude, Grok or GPT.** A companion answers through the Claude API, through xAI's on Grok or
  through OpenAI's on GPT, with or without memory; a Grok or GPT one can have memory turned on
  later. They never mix: a Grok companion's memory is kept by Grok, a GPT one's by GPT. See
  [providers](docs/providers.md).
- **Pictures and reading aloud.** A picture of any moment, or of the companion, made by CivitAI,
  Grok Imagine or OpenAI;
  replies read aloud by Azure AI Speech or in one of Grok's voices, each line with its feeling. See
  [Scenes, pictures and reading aloud](docs/scenes-pictures-speech.md).
- **When the API declines a turn**, the refusal is kept and shown, and another model can answer
  instead. See [Chats](docs/chats.md#when-the-api-declines-a-turn).

## Documentation

The [`docs/`](docs/README.md) folder explains how everything works:
[how memory works](docs/memory.md), [chats](docs/chats.md),
[Claude, Grok or GPT, with or without memory](docs/providers.md),
[scenes, pictures and reading aloud](docs/scenes-pictures-speech.md), and
[how it is built](docs/architecture.md), for working on the code.

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

For Grok, add the xAI key the same way (it also reads aloud in Grok's voices):

```bash
echo 'XAI_API_KEY=<your key>' >> valhalla2/data/secret.env
```

For GPT, add the OpenAI key the same way:

```bash
echo 'OPENAI_API_KEY=<your key>' >> valhalla2/data/secret.env
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

`CHAT_MODEL=grok-4.7 pnpm --filter valhalla2 smoke` makes a Grok companion instead: the chat runs on
Grok, and so does its memory step, with Grok as the memory model. `CHAT_MODEL=gpt-6-luna` does the
same on GPT.

## Settings

Set in `dev.env` for development and in `deploy/valhalla2.service` on a server. Every one has a
default.

| Variable                        | Default                                          | What it does                                                       |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `CHAT_MODEL`                    | `claude-haiku-5-5`                               | The model a new companion answers with. Each can change it.        |
| `MEMORY_MODEL`                  | `claude-sonnet-5-5`                              | The model a new companion keeps its memory with. Each can change.  |
| `VALHALLA_SWIPE_ASK`            | `5`                                              | Swipes on one reply before asking why they aren't working.         |
| `VALHALLA_WINDOW_TOKENS`        | `20000`                                          | About how many tokens of a chat are sent each turn.                |
| `VALHALLA_GROK_WINDOW_TOKENS`   | `60000`                                          | The same, for a Grok companion with memory.                        |
| `VALHALLA_OPENAI_WINDOW_TOKENS` | `60000`                                          | The same, for a GPT companion with memory.                         |
| `VALHALLA_WINDOW_CHUNK`         | `10`                                             | How many exchanges slide out at once when a chat outgrows that.    |
| `VALHALLA_IDLE_MINUTES`         | `30`                                             | How long a chat is quiet before it is folded into memory.          |
| `VALHALLA_MEMORY_FILE_KB`       | `8`                                              | The largest a memory file may be.                                  |
| `VALHALLA_MEMORY_STORY_KB`      | `16`                                             | The largest `story/recent.md` and `story/arcs.md` may be.          |
| `VALHALLA_MEMORY_FILES`         | `20`                                             | How many memory files a companion may have.                        |
| `VALHALLA_MEMORY_ITERATIONS`    | `16`                                             | The most requests one run of the memory model may make.            |
| `VALHALLA_CLEANUP_EVERY`        | `10`                                             | Consolidations between two tidy-ups of a companion's memory.       |
| `VALHALLA_CLEANUP_DAYS`         | `7`                                              | …or days, if memory changed at all in that time.                   |
| `VALHALLA_BACKUPS_KEPT`         | `14`                                             | How many daily backups of the database are kept.                   |
| `PICTURE_MODEL`                 | `urn:air:sdxl:checkpoint:civitai:827184@2883731` | The CivitAI model that makes pictures, as an AIR.                  |
| `PICTURE_PROMPT_MODEL`          | `claude-sonnet-5-5`                              | The model that writes a picture's prompt.                          |
| `GROK_PICTURE_MODEL`            | `grok-imagine-image-2.0`                         | The xAI image model a companion on Grok Imagine makes pictures on. |
| `OPENAI_PICTURE_MODEL`          | `gpt-image-2.6-flare`                            | The OpenAI image model a companion on OpenAI makes pictures on.    |
| `SCENE_MODEL`                   | `claude-haiku-5-5`                               | The model a new companion works out a picture's scene with.        |
| `TONE_MODEL`                    | `claude-haiku-5-5`                               | The model a new companion works out how lines are said aloud with. |
| `VALHALLA_SCENE_TOKENS`         | `12000`                                          | About how much of the chat it reads, up to the moment.             |
| `SPEECH_REGION`                 | `brazilsouth`                                    | The Azure region of the Speech resource the key belongs to.        |
| `SPEECH_VOICE`                  | `en-US-AvaMultilingualNeural`                    | The voice for a companion that chooses none (`grok:eve` for Grok). |

The unit file sets both models to Haiku 5.5 and Sonnet 5.5.

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

**So does the xAI key**, which lets a companion answer on Grok and read aloud in Grok's voices; an
empty file means no Grok:

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla2-xai.key && unset KEY
```

**So does the OpenAI key**, which lets a companion answer on GPT; an empty file means no GPT:

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla2-openai.key && unset KEY
```

**So does the Azure Speech key**, which reads replies aloud; again an empty file means none. Its
region is `SPEECH_REGION` in `deploy/valhalla2.service` (`brazilsouth`): a key from a resource in
another region needs that line changed too.

```
read -rs KEY && printf '%s' "$KEY" | sudo install -m 600 -o root -g root /dev/stdin /etc/axis-suite/valhalla2-speech.key && unset KEY
```

Everyone who can sign in to Heimdall can talk to companions on this key, so give the suite a key of
its own and set a monthly spend limit for it in the Claude Console. The same goes for the xAI key,
in the xAI Console.

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

## Not here yet

- **Scenes** — the frame a chat sits in, reusable across companions.

# Claude or Grok, with or without memory

Two things are chosen when a companion is created:

- **Claude or Grok.** The Model picker offers both (Grok when the server has an xAI key). A Claude
  companion can later move to any other Claude model, a Grok one to any other Grok model, but never
  across. Anthropic and xAI have different usage policies, so the two never mix: **everything a Grok
  companion asks goes to xAI, everything a Claude companion asks goes to Anthropic**, its memory
  model included. A request for a model of the other API is refused, not sent.
- **With or without memory.** A Claude companion keeps the choice for good. A Grok companion made
  without memory can have it turned on later (see [Turning memory on](#turning-memory-on)), but
  never off.

|                       | Claude with memory                                        | Grok with memory                         | Without memory (Claude or Grok)               |
| --------------------- | --------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| What a chat sends     | profile, memory, pins, topics to leave alone; about 20K   | the same; about 60K                      | profile and pins; the chat, up to 160K tokens |
| Memory model          | a Claude model (Sonnet 5.5 by default)                    | a Grok model (its chat model by default) | none                                          |
| A picture of a moment | drawn from the scene, worked out from memory and the chat | the same, by Grok                        | drawn from that one message and the profile   |
| Reading aloud         | with the feeling of each line, from its tags (or plainly) | the same, by Grok                        | the same, on the companion's own API          |
| Leave alone           | yes                                                       | yes                                      | no                                            |
| Scene                 | yes                                                       | yes                                      | no                                            |
| A like's comment      | read by the memory model                                  | read by the memory model                 | no comment: a like is only a mark for you     |
| Canon or one-shot     | decides what memory keeps                                 | decides what memory keeps                | makes no difference                           |

How a companion with memory remembers is in [How memory works](memory.md). It is the same on both
APIs: the same files, the same runs, the same rules. Only the model that keeps it differs.

## Memory on Grok

A Grok companion's memory is kept by a Grok model, its **Memory model** setting, which starts as
its chat model. Claude never sees any of it.

- **The memory tool is a function.** xAI has no built-in memory tool, so Grok is given one function,
  `memory`, with the same commands as Anthropic's (`view`, `create`, `str_replace`, `insert`,
  `delete`, `rename`). Valhalla 2 carries them out exactly as for Claude, with the same limits, the
  same one-shot rules and the same log, so either model's runs look alike on the Memory page.
- **More of the chat is sent**: about 60K tokens (`VALHALLA_GROK_WINDOW_TOKENS`) rather than Claude's
  20K, so more of a scene stays word for word. A model with a smaller window gets less, as without
  memory. What slides out is filed into memory first, as on Claude.
- **A filtered run fails.** There is no fallback model, so a run xAI filters changes nothing, as a
  declined run does on Claude, and is tried again when the chat changes.
- **Its thinking is kept within a run.** Grok's reasoning comes back encrypted; a run sends it back
  with each step, so the model doesn't lose its train of thought, and nothing of it is stored.
- **Cost.** A run is a few requests in a row, each re-reading the earlier ones at the cached rate
  ($0.50 per million on Grok 4.7): a few cents a run. Each turn of a chat sends about 60K tokens,
  most of it from the cache, about a cent.
- **Scenes and tags are Grok's too.** A Grok companion's scenes (with memory) and the tags its
  replies are read aloud with are read by a Grok model, its **Scene model** and **Tone model**
  (its chat model to start with), at their own effort, sent as `reasoning.effort` as for a reply.

### Turning memory on

A Grok companion without memory has **Turn memory on…** on its Pins page. It asks first, then:

1. The memory model reads every chat the companion has had, one after another, as a
   [rebuild](memory.md#rebuilding) does, and writes the memory files from them.
2. Meanwhile the companion's chats carry on as before, without memory.
3. When every chat has been read, memory is on: the Pins page becomes the Memory page, and each chat
   sends its last 60K tokens with the memory before it from its next turn on.

If any step fails, nothing changes, the companion is still without memory, and the run's error is
on the page. Memory can't be turned off again afterwards.

## Long chats without memory

Without memory, a chat is sent whole until it reaches about 160K tokens. Then its oldest turns slide
out, down to about 120K, and a line in the chat shows where. What slides out is forgotten: there is
no memory to keep it.

The limit keeps every request under 200K tokens, past which xAI bills the whole prompt at twice the
rate. A model with a smaller window slides before that window instead (less room for the reply). The
count is only an estimate, about four characters a token, hence the margin. A slide goes well below
the limit so that the next one is many turns away: each slide costs the prompt cache once, and the
cache is what keeps a long chat affordable.

A Grok companion's picture prompt is written by its own model; a Claude companion's by
`PICTURE_PROMPT_MODEL`, with or without memory.

## What differs on Grok

The request is built by the same code as a Claude one, and Inspect shows it the same way. What
differs is forced by xAI's API:

- **Temperature.** A Grok companion has a temperature, from 0 to 1. It starts on **Grok's default**,
  which sends none; Grok never samples above 1. Claude's models reject a temperature, so a Claude
  companion has none. The memory model never gets one.
- **Effort** goes out as Grok's `reasoning.effort`. Grok has no `max`, so `max` is sent as `xhigh`.
  It is always sent, because Grok's own default is `high`, slow and dear for dialogue. Memory runs
  use `medium`, as on Claude.
- **Stop sequences are applied by Valhalla 2**, because Grok's reasoning models refuse them. The
  moment the reply reaches one, it is cut there and the request is ended. A reply cut that way has no
  usage reported, so its cost is not shown.
- **Caching is automatic.** There is no lifetime to choose and no breakpoint to set; each chat's
  requests carry its id as `prompt_cache_key`, so they land on the same cache, and each memory run
  its own. Cached input is $0.50 per million against $2.00. A prompt of 200K tokens or more is billed
  at twice the rate, all of it.
- **Only text is kept.** Grok's reasoning comes back encrypted and is not stored.
- **There is no fallback model and no classifier category.** A reply xAI filters is stored as a
  refusal, with whatever it said. What to do about one is in
  [Chats: When a reply steps out of character](chats.md#when-a-reply-steps-out-of-character).
- **A chat can't be counted before it is sent**: xAI has no counting endpoint. The context line
  under the composer shows what the last reply sent instead.
- **Nothing is kept by xAI.** Requests go out with `store: false`.

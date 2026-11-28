# Claude, Grok or GPT, with or without memory

Two things are chosen when a companion is created:

- **Claude, Grok or GPT.** The Model picker offers all three (Grok when the server has an xAI key,
  GPT when it has an OpenAI key). A Claude companion can later move to any other Claude model, a
  Grok one to any other Grok model, a GPT one to any other GPT model, but never across. Anthropic,
  xAI and OpenAI have different usage policies, so they never mix: **everything a Grok companion
  asks goes to xAI, everything a GPT companion asks goes to OpenAI, everything a Claude companion
  asks goes to Anthropic**, its memory model included. A request for a model of another API is
  refused, not sent.
- **With or without memory.** A Claude companion keeps the choice for good. A Grok or GPT companion
  made without memory can have it turned on later (see [Turning memory on](#turning-memory-on)), but
  never off.

|                       | Claude with memory                                        | Grok or GPT with memory                        | Without memory (any API)                      |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| What a chat sends     | profile, memory, pins, topics to leave alone; about 20K   | the same; about 60K                            | profile and pins; the chat, up to 160K tokens |
| Memory model          | a Claude model (Sonnet 5.5 by default)                    | one of its own API (its chat model by default) | none                                          |
| A picture of a moment | drawn from the scene, worked out from memory and the chat | the same, by its own API                       | drawn from that one message and the profile   |
| Reading aloud         | with the feeling of each line, from its tags (or plainly) | the same, by its own API                       | the same, on the companion's own API          |
| Leave alone           | yes                                                       | yes                                            | no                                            |
| Scene                 | yes                                                       | yes                                            | no                                            |
| A like's comment      | read by the memory model                                  | read by the memory model                       | no comment: a like is only a mark for you     |
| Canon or one-shot     | decides what memory keeps                                 | decides what memory keeps                      | makes no difference                           |

How a companion with memory remembers is in [How memory works](memory.md). It is the same on every
API: the same files, the same runs, the same rules. Only the model that keeps it differs.

Grok and GPT both speak OpenAI's Responses API, so Valhalla 2 builds their requests with the same
code; what tells them apart is listed under [What differs on Grok](#what-differs-on-grok) and
[What differs on GPT](#what-differs-on-gpt).

## Memory on Grok and GPT

A Grok or GPT companion's memory is kept by a model of its own API, its **Memory model** setting,
which starts as its chat model. Claude never sees any of it, and neither does the other API.

- **The memory tool is a function.** Neither xAI nor OpenAI has a built-in memory tool, so the model
  is given one function, `memory`, with the same commands as Anthropic's (`view`, `create`,
  `str_replace`, `insert`, `delete`, `rename`). Valhalla 2 carries them out exactly as for Claude,
  with the same limits, the same one-shot rules and the same log, so every model's runs look alike
  on the Memory page.
- **More of the chat is sent**: about 60K tokens (`VALHALLA_GROK_WINDOW_TOKENS`,
  `VALHALLA_OPENAI_WINDOW_TOKENS`) rather than Claude's 20K, so more of a scene stays word for word.
  A model with a smaller window gets less, as without memory. What slides out is filed into memory
  first, as on Claude.
- **A filtered run fails.** There is no fallback model, so a run the API filters changes nothing, as
  a declined run does on Claude, and is tried again when the chat changes.
- **Its thinking is kept within a run.** The reasoning comes back encrypted; a run sends it back with
  each step, so the model doesn't lose its train of thought, and nothing of it is stored.
- **Cost.** A run is a few requests in a row, each re-reading the earlier ones at the cached rate
  ($0.50 per million on Grok 4.7, $0.01 on GPT-6 Luna): a few cents a run on Grok, a fraction of a
  cent on Luna. Each turn of a chat sends about 60K tokens, most of it from the cache.
- **Scenes and tags are its own API's too.** A Grok or GPT companion's scenes (with memory) and the
  tags its replies are read aloud with are read by a model of its own API, its **Scene model** and
  **Tone model** (its chat model to start with), at their own effort, sent as `reasoning.effort` as
  for a reply.

### Turning memory on

A Grok or GPT companion without memory has **Turn memory on…** on its Pins page. It asks first, then:

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
rate (OpenAI's dearer rate starts later, past 272K). A model with a smaller window slides before
that window instead (less room for the reply). The count is only an estimate, about four characters
a token, hence the margin. A slide goes well below the limit so that the next one is many turns
away: each slide costs the prompt cache once, and the cache is what keeps a long chat affordable.

A Grok or GPT companion's picture prompt is written by its own model; a Claude companion's by
`PICTURE_PROMPT_MODEL`, with or without memory.

## What differs on Grok

The request is built by the same code as a Claude one, and Inspect shows it the same way. What
differs is forced by xAI's API:

- **Temperature.** A Grok companion has a temperature, from 0 to 1. It starts on **Grok's default**,
  which sends none; Grok never samples above 1. Claude's and GPT's models reject a temperature, so
  their companions have none. The memory model never gets one.
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

## What differs on GPT

A GPT companion's requests are built by the same code as a Grok one's, through OpenAI's own API.
Most of [What differs on Grok](#what-differs-on-grok) holds for it too: stop sequences applied by
Valhalla 2, only text kept, no fallback model, a filtered reply stored as a refusal, and
`store: false`, so nothing is kept by OpenAI. What is its own:

- **No temperature.** GPT's reasoning models take none, as Claude's don't.
- **Effort** goes out as OpenAI's `reasoning.effort`, all five as they are, `max` included. It is
  always sent; memory runs use `medium`.
- **Caching is automatic, for half an hour** after each turn. There is no lifetime to choose. Unlike
  Grok, OpenAI bills what it writes to the cache: 1.25 times the input rate, as Claude's 5-minute
  cache does, and the cost under a reply counts it. On GPT-6 Luna, input is $0.10 per million, a
  cached read $0.01, and output $0.50. A prompt over 272K tokens is billed at a dearer rate, all of
  it ($0.20, $0.02 and $0.75).
- **A chat is counted before it is sent**, through OpenAI's counting endpoint, so the context line
  under the composer shows the chat as it stands, as on Claude. If counting fails, it shows what the
  last reply sent instead, as on Grok.
- **Context windows are written down**, since OpenAI's API doesn't say them: GPT-6 Luna's is
  1,050,000 tokens. A `gpt-` model typed in by hand that isn't on the list shows no window, and a
  chat on it without memory keeps to the usual 200K limit.

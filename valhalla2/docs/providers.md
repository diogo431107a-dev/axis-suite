# Claude or Grok, with or without memory

Two things are chosen when a companion is created, and never change:

- **Claude or Grok.** The Model picker offers both (Grok when the server has an xAI key). A Claude
  companion can later move to any other Claude model, a Grok one to any other Grok model, but never
  across. Anthropic and xAI have different usage policies, so the two never mix: **everything a Grok
  companion asks goes to xAI, everything a Claude companion asks goes to Anthropic.** A request for a
  model of the other API is refused, not sent.
- **With or without memory**, for a Claude companion. A Grok companion is always without.

|                       | With memory (Claude)                                       | Without memory (Grok, or Claude)              |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| What a chat sends     | profile, memory, pins, topics to leave alone; the window   | profile and pins; the chat, up to 160K tokens |
| Memory model          | after a chat goes quiet, or "Remember now"                 | none                                          |
| A picture of a moment | drawn from the scene, worked out from memory and the chat  | drawn from that one message and the profile   |
| Reading aloud         | with the feeling of each line, from the scene (or plainly) | plainly, as written                           |
| Scene, leave-alone    | yes                                                        | no                                            |
| A like's comment      | read by the memory model                                   | no comment: a like is only a mark for you     |
| Canon or one-shot     | decides what memory keeps                                  | makes no difference                           |

How a companion with memory remembers is in [How memory works](memory.md).

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
  companion has none.
- **Effort** goes out as Grok's `reasoning.effort`. Grok has no `max`, so `max` is sent as `xhigh`.
  It is always sent, because Grok's own default is `high`, slow and dear for dialogue.
- **Stop sequences are applied by Valhalla 2**, because Grok's reasoning models refuse them. The
  moment the reply reaches one, it is cut there and the request is ended. A reply cut that way has no
  usage reported, so its cost is not shown.
- **Caching is automatic.** There is no lifetime to choose and no breakpoint to set; each chat's
  requests carry its id as `prompt_cache_key`, so they land on the same cache. Cached input is $0.50
  per million against $2.00. A prompt of 200K tokens or more is billed at twice the rate, all of it.
- **Only text is kept.** Grok's reasoning comes back encrypted and is not stored.
- **There is no fallback model and no classifier category.** A reply xAI filters is stored as a
  refusal, with whatever it said. What to do about one is in
  [Chats: When a reply steps out of character](chats.md#when-a-reply-steps-out-of-character).
- **A chat can't be counted before it is sent**: xAI has no counting endpoint. The context line
  under the composer shows what the last reply sent instead.
- **Nothing is kept by xAI.** Requests go out with `store: false`.

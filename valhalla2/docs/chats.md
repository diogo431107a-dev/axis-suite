# Chats

How a chat works: what is sent, how replies can be written again and branched, how likes and modes
work, what happens when the API declines a turn or a reply steps out of character, and what each
turn costs. How the companion
remembers across chats is in [How memory works](memory.md).

## What Valhalla 2 adds to a request

Valhalla 2 adds no content checks, no refusal wrapping, no warnings and no nagging of its own. You
decide what to send.

- **The prompt is yours.** The system prompt is your companion's profile, exactly as you wrote it.
- **Valhalla 2's own words are few, and yours to rewrite.** A chat needs a little text you didn't
  write: the memory policy that comes with the companion's memory, the instruction that has it open
  the chat, the note that passes on why you rejected a reply, the instructions the memory model
  works by, the ones a scene, a picture's prompt and the tags a reply is read aloud with are made by,
  and the notes above your pins and the topics to leave alone. Each companion has its own copy of every one of them, which
  you can rewrite or leave on the default. A default that improves reaches every companion that
  never changed it.
- **Inspect shows everything.** The **Inspect** panel in a chat shows the exact request that goes
  out, built by the same code that sends it, with every hidden part marked.
- **Nothing is softened on the way back.** If the API declines a turn, that turn is stored and
  shown as a refusal, with the category and the explanation it gave, word for word.
- **Nothing is hidden on the way out.** A companion's settings are the whole request: model,
  effort, reply length, stop sequences, cache lifetime.

The one thing Valhalla 2 does on your behalf is ask the API for a fallback model when a turn is
declined ([below](#when-the-api-declines-a-turn)). It is a checkbox, on by default, off whenever you
want, and either way Valhalla 2 itself filters nothing.

## A chat is a tree

Every reply can be written again (a **swipe**), and every message can be **edited**, **deleted**,
**branched from**, copied or pinned: what you say after a branch starts a new line from there.
Nothing you haven't deleted is thrown away. The versions you didn't pick and the branches you left
stay in the chat, one click away (‹ 2/3 ›), but only the **selected path** is "what happened": it is
the only thing sent to the model, and the only thing memory reads.

- **An edit** keeps the earlier words beside the new ones.
- **A delete** removes a message and everything after it from the chat. It is only marked deleted in
  the database.
- **Every chat opens with the companion's greeting.** The API takes no conversation that starts with
  the companion, so the greeting answers a fixed, hidden first message (`[The chat begins.]`)
  followed by the **Greeting instruction**. Both are stored with the greeting and sent again,
  unchanged, on every later turn. Inspect shows them.

After the fifth swipe on the same reply (`VALHALLA_SWIPE_ASK`), Valhalla 2 asks once why the
versions aren't working. The question can be skipped. An answer goes, hidden, with every later
version of that reply, so it is used straight away, and the memory model reads it at its next run.

## Canon or one-shot

Each chat is **canon** (part of your story together) or a **one-shot** (a standalone scenario). You
choose when you open it, and can change it later. The companion is told which it is, and memory
keeps a one-shot's events out of the story while keeping what it shows about the two of you. The
details, including what switching does, are in
[How memory works: Canon and one-shot](memory.md#canon-and-one-shot).

## Liking a reply

Swipes tell memory what didn't work; a like tells it what did. The heart under a companion's reply
likes it at once and opens a box asking what made it good. There is no dislike: a swipe, with its
reason, already is one.

- **With a comment**, the like is praise. The memory model reads it at its next run and keeps what
  it shows as "what to keep doing" in `feedback.md`, in general terms rather than as a quote. It
  never goes into the chat's own messages, so the next reply, the cache and the companion's earlier
  thinking are untouched.
- **Without one**, the like is only for you: it is kept and shown, and nothing is sent anywhere.
- **It keeps the words you liked.** Edit the reply later and the praise is still about what it said
  then. Liking a version you then swipe away is fine: it counts for the writing, never for facts or
  events.
- **Taking it back.** Change the comment, remove it, unlike, or delete the reply, and the memory
  model takes back what came only from it.
- **It is not a pin.** The memory model rewrites praise in its own words. For words that must stay
  exactly as they were said, pin them.

The comment shows in small print under the reply; tap the heart again to change it or unlike. How
the memory model uses it is in [How memory works: Likes and swipe reasons](memory.md#likes-and-swipe-reasons).

## When the API declines a turn

The current models run **Anthropic's safety classifiers** on every request. They are part of the
API, not of Valhalla 2, and they are separate from the model's own judgement. When one of them flags
a request, the API still answers with success, but with no reply (or a reply cut short) and a
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

**A declined turn is kept but not sent back.** The API takes no empty reply mid-conversation, so the
refusal and your message before it are left out of what later turns send. Both stay in the chat, and
you can say it another way.

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

## When a reply steps out of character

Sometimes a reply isn't the companion at all but the model speaking for itself: "I won't continue
with this." It comes in two kinds, and they need different handling.

- **Shown as a refusal**, a declined turn ([above](#when-the-api-declines-a-turn)). It is already
  left out of what later turns send. A swipe sends the same request again and usually gets the
  same answer, so say it another way instead, or tick the fallback.
- **An ordinary reply that refuses.** The model wrote it as its answer, so Valhalla 2 treats it as
  one: while it is on the selected path, it goes out with every later turn, and the memory model
  reads it. A model tends to stay consistent with what it has already said, so a refusal left in
  place makes the next one likelier.

**What works, in order:**

1. **Swipe.** A refusal like this is often just bad luck in how the reply was drawn. The version
   you swipe away leaves the selected path, so neither later turns nor memory see it.
2. **If it refuses again at the same point, edit your own message**, not the reply. What set it off
   is in what you sent. Add what the model was missing (that this is a story, where the scene is
   going, that the characters are adults) and let it write again.
3. **At the fifth swipe, answer the question.** Your answer goes, hidden, with every later version
   of that reply ([above](#a-chat-is-a-tree)), so it works as an instruction. Say what you want
   rather than what went wrong: "Stay in character; this is a story we are writing together."
4. **If it happens in chat after chat, put that context in the profile.** The profile goes with
   every turn, so it deals with the cause rather than one reply.

**What doesn't help:**

- **Arguing, correcting or apologizing in the chat.** The refusal stays in, and your next message
  reads as pushing back on it, so the model tends to hold its ground or hedge. An apology also tells
  it the request was out of line. A short out-of-character note works better inside your edited
  message than as an answer to the refusal.
- **Deleting it.** A swipe already takes it off the path. Delete only to have it gone from the
  chat altogether.
- **Branching.** A branch is for keeping one line of the story while trying another, not for
  getting past a refusal.

If the same scene is declined however you put it, and by the fallback model too, it is probably
something the usage policy rules out, and no wording will change that.

**On Grok** ([what differs](providers.md#what-differs-on-grok)), the same order works, with these
differences:

- **No fallback.** A reply xAI filters is shown as a refusal, with no category, and can only be
  written again or said differently.
- **Temperature decides how different a swipe is.** At a low temperature a swipe writes much the
  same reply again, refusal included. For a reply that keeps refusing, raise it, or go back to
  Grok's default, then swipe.
- **Without memory, nothing tidies up after you.** Nothing drops the refusal: left in the chat, it
  is sent with every turn until the chat reaches about 160K tokens and it slides out. Swipe it or
  edit your message rather than talking past it. With memory it is as on Claude: it stays until it
  slides out of the 60K window, and the memory model reads it.
- **Without memory, the profile is the only place that lasts.** The fifth-swipe answer helps only
  that reply, and no memory carries it into later chats. With memory, it reaches `feedback.md` as
  on Claude.
- **The policy is xAI's**, not Anthropic's, so what one declines the other may not. A companion
  can't move between the two (see [Claude or Grok](providers.md)).

## Things the current API decides, not Valhalla 2

These surprise people coming from other companion apps. They are not choices made here; ignoring
them produces errors.

- **There is no temperature** on Claude. `temperature`, `top_p` and `top_k` are rejected by the
  current models. `effort` is the dial that replaced them: how long the model thinks before it
  speaks, and so how many tokens a reply costs. Haiku holds a character well on `high`. (A Grok
  companion does have a temperature: see [providers](providers.md#what-differs-on-grok).)
- **The first message must be yours**, hence the hidden opener before the greeting
  ([above](#a-chat-is-a-tree)).
- **Thinking is bound to the conversation.** The API ties each piece of the model's thinking to the
  exact conversation before it. An edit or a delete changes that conversation, so every request asks
  the API to drop the thinking that no longer matches (beta `thinking-binding-controls-2026-08-01`)
  instead of refusing it. The replies after an edit are written without that earlier reasoning,
  and the cache starts again from the edit.
- **A refusal is an answer**, delivered successfully with a category attached, not an error
  ([above](#when-the-api-declines-a-turn)).
- **The prompt cache needs a minimum length** (512 tokens or more, depending on the model). A
  two-line profile will silently never cache. Watch `cached` under the composer: it should climb
  turn after turn. If it stays at zero on a long chat, something in the prompt is changing between
  requests.

## What a turn costs

Each turn re-sends the selected path, up to the window
([How memory works: The window](memory.md#the-window-long-chats-slide)). The prompt cache is what
makes that affordable: on Claude Opus 5.5 input is $4.00 per million tokens and a cache read is
$0.20, so everything already said costs a twentieth to send again. Valhalla 2 puts a breakpoint at
the end of the system prompt and another that follows the chat as it grows, and every request for
the same companion and path is built exactly the same way (no dates, no ids), so the cache keeps
matching.

Each reply shows what it cost at the published prices: a cache write at 1.25 times the input price
for 5 minutes and twice for an hour, every model that tried a declined turn added up. It is an
estimate; the Claude Console has the bill.

The cache keeps a chat for 5 minutes or an hour, your choice per companion. An hour is the default
because people pause, and a cold cache costs twenty times a warm one.

**Economical defaults.** A new companion answers on Haiku 5.5 at high effort: forty times cheaper
than Opus 5.5 per token, and it holds a character well. Memory stays on Sonnet 5.5, and picture
prompts too, because those are judgement work done once per chat or picture. Any companion can
still be moved to a dearer model in its settings.

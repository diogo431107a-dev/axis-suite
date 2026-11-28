# Scenes, pictures and reading aloud

A picture of a moment is drawn from the **scene**; a reply read aloud with feeling follows its
**tags**. They are two readings, each for its own purpose, by models you choose on the companion's
page. Both are optional: without a CivitAI key Valhalla 2 makes no pictures, and without an Azure
Speech key it reads nothing aloud.

## The scene

A picture needs to understand the moment: where and when it happens, how the character looks right
now, and what they feel. One message alone rarely says: the rain was thirty messages ago. So
before a picture, the companion's **Scene model** reads its profile, its memory and pinned moments,
and the chat up to the moment (about `VALHALLA_SCENE_TOKENS` of it), and works out the scene:

- **the setting**: place, time of day, the weather and what it has done, the light;
- **the atmosphere**: the colours and mood the picture should carry (warm reds for anger, a cold
  blue dusk for loneliness);
- **the character**: their look right now, their clothes and their state (soaked, torn), what they
  are doing, their mood with a few words of why, and **how it shows** in a drawing (flushed
  cheeks, an anger vein, tears).

It focuses on the character alone. You are in the picture only if you add yourself: **Someone
else** in the scene dialog adds anyone you want drawn, the user included.

It is read once per message and kept, and nothing is added to the chat itself: what the companion
is sent each turn doesn't change. It is read again when the chat up to the moment changes (an
edit, another version), not when only the memory does. Its cost depends on the model: about 15–25K
tokens in, so about 0.3¢ on Haiku 5.5 and about 5¢ on Sonnet 5.5 or Grok 4.7.

The clapperboard under any message opens it: correct anything and save, and it stays as you left
it until the message's own words change. **Read it again** asks afresh. Which model read it, what
was sent and what it cost are under it. How the scene is read is one of the companion's own texts,
**Scene reading instructions**; the model and its effort are **Scene model** and **Scene effort**
under Settings.

The scene needs memory. A companion without memory draws its pictures from the message itself.
A Claude companion's scene is read by Claude, a Grok companion's by Grok (see
[providers](providers.md)).

## Pictures

A picture of the moment, or of the companion. Under any message, the picture button works out the
scene (above), or uses the one kept, and asks for a prompt for the image model from it (on Claude,
`PICTURE_PROMPT_MODEL`, Sonnet 5.5; on Grok, the companion's own model): the people the scene lists
and what they look like, their expressions, what they are doing, the place, the light, the
colours. The image model invents whatever a prompt leaves unsaid, so Claude is told to
state all of it, choosing something plain where nothing says. A profile picture is written from the
profile and the memory. Nothing runs on ordinary replies; a prompt costs a cent or two, and only
when you ask.

The dialog shows the scene the prompt was drawn from; **Correct the scene** opens it, and the prompt
can then be written again from the correction.

The prompt opens in a dialog for you to change, with a note for Claude ("at sunset", "from behind")
if you want it written again. **Make the picture** sends it to CivitAI, which makes it on the
WAI-illustrious SDXL checkpoint (`PICTURE_MODEL`) with the companion's picture settings, at a size
SDXL was trained on for the shape Claude chose. It takes a few seconds to a minute; the picture
appears under its message when it is done, only on that branch of the chat.

**Picture settings** are under **Pictures** on the companion's page: **Steps** (10–60, 20 to
start; more is finer, slower and dearer), **CFG** (1–15 in halves, 7 to start; higher follows the
prompt more literally), **Sampler** (Euler a to start; the DPM++ ones cost a little more Buzz) and
**Clip skip** (1–3, 2 to start, which suits anime checkpoints).

**The seed carries on.** The picture dialog shows the seed the picture will be made with: the
companion's, or a new one if it has none yet. The dice rolls another. Whatever seed a picture is
made with becomes the companion's, so the next picture starts from it too, and pictures of the same
moment stay alike. The companion's seed can also be typed, or cleared, under **Pictures**; an empty
one is rolled at the next picture. A seed Valhalla 2 rolls has ten digits.

Each companion's **Pictures** page, from its own page, has two shelves: **Profile pictures**, made
there from the profile alone, and **Chat pictures**, each naming the chat it came from. Any picture
can be opened full size, made again from the same prompt (the dialog shows the seed, and the dice
rolls a new one), or deleted. Under each picture are the steps, CFG, sampler, clip skip and seed it
was made with. How Claude
writes the prompts is one of the companion's own texts, **Picture instructions**, which you can
rewrite like the others.

Pictures are files on the server's disk, read from there each time they are shown. A deleted chat
leaves its pictures in the gallery; a deleted companion takes its pictures with it.

## Reading aloud

A companion's replies can be read aloud, by Azure AI Speech's neural voices.

- **Each companion has its own voice.** Under **Voice** on a companion's page you can choose any of
  the voices Azure offers in the server's region (over five hundred, in some 150 languages), and
  find one by name, language or gender. **Hear it** reads a line you can change, so you hear a voice
  before choosing it; that counts toward the month's characters like a reply, and hearing the same
  words again is free. A companion that chooses none is read in the server's voice, Ava
  (`en-US-AvaMultilingualNeural`) unless `SPEECH_VOICE` says otherwise. A voice marked multilingual
  also reads other languages, telling them from the text; any other voice reads in its own language.
  Changing the voice reads a reply again, in the new voice, the next time you play it.
- **Speed, pitch and style.** Under the voice, **Speed** (from half to twice the voice's usual) and
  **Pitch** (up to half lower or higher) are kept with the companion, and **Hear it** reads at them
  before you save. A voice with styles of its own also offers a **Speaking style** (chat, friendly,
  calm…): every line is read in it, unless the line's feeling has a style of its own that fits
  better. Feelings are read on top of all three: a whisper is still slower than the companion's own
  speed. Changing any of them reads a reply again the next time you play it; audio read before they
  existed is kept as long as they stay at the voice's usual.
- **As replies arrive.** The speaker switch in a chat's header (**Aloud** / **Silent**) says whether
  each new reply, version or greeting is read as soon as it is written. It is remembered by the
  browser, not the companion — on at home, off on the phone in public — and starts on.
- **With feeling.** Unless **Read with feeling** is off on the companion's page, a reply is read the
  way its tags say each line is said (below), worked out the first time it is read. A line whose
  feeling matches one of the voice's own styles is read in it; only about fifty voices have styles
  (most of them US English or Chinese; among the Brazilian Portuguese ones only Francisca, "calm"),
  and the voice finder shows them ("styles"). Every other line, on any voice, is read with speed,
  pitch and volume set for its feeling: a whisper softer and slower, anger louder and quicker.
  Actions are read a little slower and quieter, as narration. If the tags can't be read (the model
  unreachable), the reply is read plainly. **Hear it** can try a voice in any feeling.
- **On demand.** The speaker button under any reply reads it; while it plays it becomes a stop
  button. Starting one reply stops the other, and leaving the chat stops it.

The whole reply is read in one voice, actions too: the asterisks around them are dropped, not
spoken. A phone's browser may refuse to start sound the page didn't get a tap for; the speaker
button under the reply always works.

**Each reply is read once.** The first time it is asked for, Azure reads it and the MP3 is kept on
the server, about 0.4 MB a minute; playing it again is instant and costs nothing. An edited reply is
read again, and the old audio deleted; so is a reply whose companion changed voice, or whose tags
you corrected. Under the composer, after the first reading in a visit, is how many characters Azure
has read this month for the whole server. Azure's free tier (F0) includes 500,000 characters a
month; the paid tier (S0) bills per million characters. Everyone who can sign in to Heimdall reads
on the server's key.

### The tags

How each line of a reply is said, for Azure: Valhalla 2 cuts the reply into lines (sentences,
actions apart from speech, so the words read are always the reply's own), and the companion's
**Tone model** gives each a feeling (teasing, whispering, angry, tender…) and how strongly. It
reads the profile and the chat just before the reply (**How much of the chat it reads**, 4,000
tokens unless you change it), not the memory: how a line is said depends on who says it and what
came just before. That is about 5K tokens, so about 0.05¢ a reply on Haiku 5.5 and about 1.5¢ on
Sonnet 5.5.

It is read the first time a reply is read aloud with feeling, and kept. Then the button with sound
waves appears under the reply: it opens the tags, line by line, to correct any and save, **Save and
hear it**, or **Read it again**; which model read them, at what effort, what was sent and what it
cost are under them. A correction stays until the reply's own words change. Tags are not read again
when only the chat before the reply changes, since that would mean reading the reply aloud again.

The tags work for every companion, with memory or without, on Claude or Grok; each is read on the
companion's own API. The model, its effort and how much of the chat it reads are under **Read with
feeling**, with the voice. How it judges a line is one of the companion's own texts, **Tone
instructions**.

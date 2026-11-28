# Scenes, pictures and reading aloud

A picture of a moment is drawn from the **scene**; a reply read aloud with feeling follows its
**tags**. They are two readings, each for its own purpose, by models you choose on the companion's
page. Both are optional: without a CivitAI key or an xAI key Valhalla 2 makes no pictures, and
without an Azure Speech key or an xAI key it reads nothing aloud.

## The scene

A picture needs to understand the moment: where and when it happens, how the character looks right
now, and what they feel. One message alone rarely says: the rain was thirty messages ago. So
before a picture, the companion's **Scene model** reads its profile, its memory and pinned moments,
and the chat up to the moment (about `VALHALLA_SCENE_TOKENS` of it), and works out the scene:

- **the setting**: place, time of day, the weather and what it has done, the light;
- **the atmosphere**: the colours and mood the picture should carry (warm reds for anger, a cold
  blue dusk for loneliness);
- **the character**: their look right now as the facts make it (dishevelled after a long journey,
  wet after the rain), their clothes and their state (soaked, torn), what they are doing, their
  mood with a few words of why, and **how it shows** in a drawing (flushed cheeks, an anger vein,
  tears);
- **the pose**: how they hold their body right now (lying on her side, knees drawn up), carried
  forward like the weather: if she lay down three messages ago and hasn't got up, she is still
  lying down;
- **the view**: how the picture sees them from that pose, and so what shows and what is hidden (from
  behind: her back and shoulders, not her face).

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
A Claude companion's scene is read by Claude, a Grok companion's by Grok, a GPT one's by GPT (see
[providers](providers.md)).

## Pictures

A picture of the moment, or of the companion, made by **CivitAI**, by **Grok Imagine** (xAI's image
model) or by **OpenAI**'s image model, whichever the companion chose (see
[Three engines](#three-engines) below). Under any message, the
picture button works out the scene (above), or uses the one kept, and asks for a prompt for the
image model from it (on Claude, `PICTURE_PROMPT_MODEL`, Sonnet 5.5; on Grok or GPT, the
companion's own model). For CivitAI in tags (the companion's **Prompt written as**) it is the fewest Danbooru
tags that do the job, about 20 to 35, since every tag pulls the picture somewhere: the people the
scene lists, their pose and how they are seen, the look and clothes that show, the expression, the
place, the light and the colours. It draws only what the pose and view show: from behind, no face
or expression, but the hair, shoulders and back; lying face down, nothing on the front of the
clothes. It leaves out what can't be drawn (names, thoughts, the weather indoors unless it shows),
and turns moods into what a picture shows (hopeful: a slight smile, looking up, warm light). In
sentences it is two or three short plain sentences, at most about 60 words, since SDXL reads only
the first 75 or so tokens well, with a short negative prompt. Either way the writer is told the
checkpoint's name and base model after its instructions, so it uses the words and quality tags
that family expects. A profile picture is written from the
profile and the memory. Nothing runs on ordinary replies; a prompt costs a cent or two, and only
when you ask.

The dialog shows the scene the prompt was drawn from; **Correct the scene** opens it, and the prompt
can then be written again from the correction.

The prompt opens in a dialog for you to change, with a note for Claude ("at sunset", "from behind")
if you want it written again. **Make the picture** sends it to the companion's engine. CivitAI makes
it on the companion's SDXL checkpoint with its picture settings, at a size
SDXL was trained on for the shape Claude chose. It takes a few seconds to a minute; the picture
appears under its message when it is done, only on that branch of the chat.

**Picture settings** are under **Pictures** on the companion's page. **Checkpoint** is the SDXL
checkpoint it draws on: WAI-illustrious-SDXL v17.0 (`PICTURE_MODEL`) to start. Paste the link to
another one's page on CivitAI (or its AIR) and press **Look up**: the server asks CivitAI's public
API what it is, refuses anything but an SDXL checkpoint (Illustrious, Pony, NoobAI, SDXL 1.0 and
the like), then asks CivitAI, with a submission that makes nothing, whether it will make pictures
on it and for how much Buzz. **Prompt written as** (Danbooru tags or plain sentences) is set from
the base model when a checkpoint is chosen (tags for Illustrious, Pony and NoobAI), and can be
changed: a semi-realistic checkpoint is yours to judge. Each style has its own instructions,
**Picture instructions (CivitAI, tags)** and **(CivitAI, sentences)**; the page shows the one in
use. Then **Steps** (10–60, 20 to
start; more is finer, slower and dearer), **CFG** (1–15 in halves, 7 to start; higher follows the
prompt more literally), **Sampler** (Euler a to start; the DPM++ ones cost a little more Buzz) and
**Clip skip** (1–3, 2 to start, which suits anime checkpoints).

**The seed carries on.** The picture dialog shows the seed the picture will be made with: the
companion's, or a new one if it has none yet. The dice rolls another. Whatever seed a picture is
made with becomes the companion's, so the next picture starts from it too, and pictures of the same
moment stay alike. The companion's seed can also be typed, or cleared, under **Pictures**; an empty
one is rolled at the next picture. A seed Valhalla 2 rolls has ten digits.

### Three engines

Under **Pictures** on a companion's page, **Made by** chooses CivitAI, Grok Imagine or OpenAI, for
any companion, Claude, Grok or GPT alike. It offers the engines the server has keys for; a server
with only one makes every picture with that one, and a companion whose engine the server has no key
for gets the first it has. Every companion starts on CivitAI.

- **CivitAI** draws on the companion's SDXL checkpoint, from Danbooru tags or plain sentences,
  with the steps, CFG, sampler, clip skip and seed above, and charges Buzz.
- **Grok Imagine** (`GROK_PICTURE_MODEL`, Grok Imagine 2.0) draws from plain sentences, on the same
  xAI key Grok companions answer with. Its prompt is written from its own instructions, **Picture
  instructions (Grok Imagine)**: two to five sentences that open with the style (an anime
  illustration, so a companion looks alike on either engine) and follow the same rules about the
  pose, the view and what shows. It has no negative prompt and no seed, so the picture dialog shows
  neither, and every picture is drawn afresh: the profile's description is what keeps the companion
  looking alike. Its settings are **Quality** (auto, which xAI makes low for a new picture; low;
  medium) and **Size** (1k or 2k), auto and 1k to start. It answers within the one request, in a few
  seconds. A picture costs about 4¢ on the server's xAI account, and its cost is shown with it.
  xAI checks every prompt against its own rules and may refuse one; the picture then says why, and
  xAI may still charge for it.
- **OpenAI** (`OPENAI_PICTURE_MODEL`, `gpt-image-2.6-flare`) draws from plain sentences, on the
  same OpenAI key GPT companions answer with. Its prompt is written from its own instructions,
  **Picture instructions (OpenAI)**, which start as Grok Imagine's do: the anime illustration
  opener and the same rules. Like Grok Imagine it has no negative prompt and no seed. Its one
  setting is **Quality** (low, medium, high, or auto, OpenAI's own choice), medium to start; the
  size follows the shape: 1024×1536, 1536×1024 or 1024×1024. It answers within the one request.
  OpenAI bills a picture by the tokens it takes, not a fixed price: about 1¢ at low, 5¢ at medium
  and 20¢ at high, and the exact cost, worked out from what OpenAI reports, is shown under each
  picture. It is asked with OpenAI's least restrictive filtering (`moderation: "low"`), but OpenAI
  still checks every prompt and may refuse one; the picture then says so.

The shape the model chose becomes Grok Imagine's 2:3 (portrait), 3:2 (landscape) or 1:1 (square),
or OpenAI's size for it. Making a picture again uses the companion's engine as it is now. Each
picture remembers which engine made it, and a picture Grok Imagine or OpenAI was making when the
server stopped is marked as not made, since there is nothing to pick up.

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

A companion's replies can be read aloud, by Azure AI Speech's neural voices or by Grok's voices
(xAI's text to speech). Azure reads on the server's Azure Speech key, Grok on the same xAI key Grok
companions answer with; a server with only one of the keys offers only that one's voices. Any
companion can choose either, Claude or Grok alike.

- **Each companion has its own voice.** Under **Voice** on a companion's page you can choose any of
  Grok's voices (listed first, two dozen or so: Eve, Ara, Rex, Leo, Sal…) or any of the voices
  Azure offers in the server's region (over five hundred, in some 150 languages), and find one by
  name, language or gender ("grok" finds Grok's). **Hear it** reads a line you can change, so you hear a voice
  before choosing it; that counts toward the month's characters like a reply, and hearing the same
  words again is free. A companion that chooses none is read in the server's voice, Ava
  (`en-US-AvaMultilingualNeural`) unless `SPEECH_VOICE` says otherwise (`grok:eve` for Grok's Eve;
  on a server with only an xAI key it is Eve). An Azure voice marked multilingual also reads other
  languages, telling them from the text; any other Azure voice reads in its own language. Every Grok
  voice reads every language, telling it from the text. Changing the voice reads a reply again, in
  the new voice, the next time you play it.
- **Speed, pitch and style.** Under the voice, **Speed** (from half to twice the voice's usual) and
  **Pitch** (up to half lower or higher) are kept with the companion, and **Hear it** reads at them
  before you save. A voice with styles of its own also offers a **Speaking style** (chat, friendly,
  calm…): every line is read in it, unless the line's feeling has a style of its own that fits
  better. Feelings are read on top of all three: a whisper is still slower than the companion's own
  speed. Changing any of them reads a reply again the next time you play it; audio read before they
  existed is kept as long as they stay at the voice's usual. Grok's voices take only the speed, from
  30% slower to half again as fast; they have no pitch setting and no styles, so the page shows only
  **Speed** for them (a pitch kept from an Azure voice stays for when you go back, and changes
  nothing on Grok).
- **As replies arrive.** The speaker switch in a chat's header (**Aloud** / **Silent**) says whether
  each new reply, version or greeting is read as soon as it is written. It is remembered by the
  browser, not the companion — on at home, off on the phone in public — and starts on.
- **With feeling.** Unless **Read with feeling** is off on the companion's page, a reply is read the
  way its tags say each line is said (below), worked out the first time it is read. A line whose
  feeling matches one of the voice's own styles is read in it; only about fifty voices have styles
  (most of them US English or Chinese; among the Brazilian Portuguese ones only Francisca, "calm"),
  and the voice finder shows them ("styles"). Every other line, on any voice, is read with speed,
  pitch and volume set for its feeling: a whisper softer and slower, anger louder and quicker.
  Actions are read a little slower and quieter, as narration. On a Grok voice each feeling becomes
  Grok's own tags instead (below), and the tone model may also give a line a **sound**. If the tags
  can't be read (the model unreachable), the reply is read plainly. **Hear it** can try a voice in
  any feeling.
- **On demand.** The speaker button under any reply reads it; while it plays it becomes a stop
  button. Starting one reply stops the other, and leaving the chat stops it.

The whole reply is read in one voice, actions too: the asterisks around them are dropped, not
spoken. A phone's browser may refuse to start sound the page didn't get a tap for; the speaker
button under the reply always works.

**Each reply is read once.** The first time it is asked for, its voice's engine reads it and the MP3
is kept on the server, about 0.4 MB a minute (Azure) or 0.5 MB (Grok); playing it again is instant
and costs nothing. An edited reply is read again, and the old audio deleted; so is a reply whose
companion changed voice, or whose tags you corrected. Under the composer, after the first reading
in a visit, is how many characters the engine that read it (Azure or Grok, each counted apart) has
read this month for the whole server. Azure's free tier (F0) includes 500,000 characters a month;
the paid tier (S0) bills per million characters. xAI bills Grok's voices per character on the
server's xAI account; its console shows the price. Everyone who can sign in to Heimdall reads on the
server's keys.

### Grok's voices

Grok reads the words with tags of its own rather than Azure's speed, pitch and volume. Each line's
feeling becomes one or more of them, more for a strong feeling than a slight one: **soft**,
**whisper**, **loud**, **slow**, **fast**, **higher pitch**, **lower pitch**, **sing-song** (playful,
teasing), **emphasis** (anger, sarcasm) and **build intensity** (shouting). A whisper is
`<whisper>`, a strong sadness slower, softer and lower; narration is soft. Lines next to each other
with the same feeling are wrapped together, since Grok reads a tag best over a whole phrase.

Grok's voices can also make sounds that aren't words, at a point: a **sigh**, **laugh**,
**chuckle**, **giggle**, **cry**, **breath**, **inhale**, **exhale**, **tsk**, **tongue click**,
**lip smack**, **hum**, and a **pause** or **long pause**. For a companion on a Grok voice the tone
model is asked for those too, only where the character would really make one (a sigh before a sad
admission, a chuckle at their own tease), a few at most in a reply. The sound is made just before
its line. The reply's own words are still read as written: brackets in them are read as
parentheses, so nothing in a reply is taken for a tag.

### The tags

How each line of a reply is said, for either engine: Valhalla 2 cuts the reply into lines (sentences,
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

The tags work for every companion, with memory or without, on Claude, Grok or GPT; each is read on the
companion's own API. The model, its effort and how much of the chat it reads are under **Read with
feeling**, with the voice. How it judges a line is one of the companion's own texts, **Tone
instructions**.

For a Grok voice, a short note asking for sounds is added after the Tone instructions, your own
words or the default alike, and the tags dialog has a **sound** for each line to correct as well.
Moving a companion to or from a Grok voice reads its tags again the next time a reply is played;
a companion on an Azure voice is asked exactly what it was before.

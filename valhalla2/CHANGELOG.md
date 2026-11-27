# Changelog

What changed in Valhalla 2, newest first. Each version is tagged in git as `valhalla2-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.42 — 2026-11-26

- **A long chat no longer forgets the turns that slide out of it for a while.** When a chat with
  memory grew past what is sent, its oldest turns stopped being sent before the memory model had
  filed them, so for a while the companion saw them neither in the chat nor in its memory. Now the
  reply waits until they are in memory (the chat says the companion is putting the oldest part of
  this chat into memory first), which makes that one reply slower. If filing them fails, the reply
  goes ahead without them, as before; if it takes over three minutes, the oldest turns are sent once
  more and the next reply tries again.
- **Switching a chat from canon to one-shot now takes its events back out of the story.** Before,
  the chat's summary and what it added to the world stayed in memory after the switch. Now the
  memory model removes them the next time it reads the chat, and keeps what other chats also show.
  What it removed is in each file's history on the Memory page, where it can be put back.
- **The README is shorter**: it keeps what Valhalla 2 does and how to run, set up and install it.
  How everything works is in the new `docs/` folder, with a full explanation of memory in
  `docs/memory.md`.

## 0.0.39 — 2026-11-26

- Runs on Node.js 24 instead of 22. The installer upgrades Node.js on the server by itself the first time it runs.

## 0.0.37 — 2026-11-26

- **Long chats without memory no longer get stuck.** A Grok companion, or a Claude one without
  memory, used to send the whole chat every turn, until the chat grew too big for the model and
  every new message was refused. Now, at about 160K tokens, its oldest turns stop being sent, and a
  line in the chat shows where. The companion no longer sees what is above that line. This also
  keeps every Grok request under 200K tokens, where xAI would charge twice the rate.

## 0.0.35 — 2026-11-26

- **Cheaper by default.** A new companion now starts on Haiku 5.5 at high effort: about forty
  times cheaper per token than Opus 5.5, and it holds a character well. Memory and picture prompts
  stay on Sonnet 5.5. Companions you already have keep their own settings: to move one, pick
  Haiku 5.5 and effort high in its settings. Switching a new companion to Grok now sets its effort
  to low, where Grok is quicker and cheaper.
- **Memory costs less to keep.** Each step of a memory update now reads the earlier steps from the
  cache instead of paying full price for them again, so memory updates and tidy-ups cost less with
  no change to what they do.

## 0.0.33 — 2026-11-26

- **A voice's speed, pitch and speaking style.** On a companion's page, under **Voice**, two new
  sliders set how fast (half to twice the usual) and how high (up to half lower or higher) its
  replies are read, and a voice with styles of its own (chat, friendly, calm…) can be given one to
  speak in. They are kept with the companion, **Hear it** tries them before you save, and feelings
  are read on top of them. Every companion starts at the voice's usual, so nothing sounds different
  until you change it, and audio already read is kept.

## 0.0.30 — 2026-11-25

- **Grok companions, and companions without memory.** A new companion is now either Claude or Grok
  (Grok 4.7, from xAI, when the server has an xAI key), and that can't change later; nothing a Grok
  companion says ever goes to Claude, or the other way round. A Grok companion has no memory: every
  chat is sent whole, with your pins, pictures are drawn from the message you choose, and replies are
  read aloud as written. A new Claude companion can be made the same way, **without memory**, or with
  memory as before. Grok companions get a **Temperature** setting (starting on Grok's own default),
  and a few settings work differently on Grok, as their hints say. Every companion you already have
  is Claude, with memory, as before. **By hand:** before installing, create
  `/etc/axis-suite/valhalla2-xai.key` (see the README), even as an empty file if you don't want Grok,
  or Valhalla 2 won't start.

## 0.0.27 — 2026-11-25

- **Memory stays in the background.** A companion was bringing the same old details up in reply
  after reply. Its memory instructions now say to raise a remembered detail only when the moment
  calls for it or you do, and to let finished arcs stay finished; the memory model keeps the gist of
  a scene instead of every count and object, and writes a finished arc as one short line. A new
  companion's canon file no longer calls its facts "highest priority". **By hand:** in an existing
  companion's `character_canon.md`, on its Memory page, change "Highest priority: never contradict
  these." to "Never contradict these, but they are background: don't bring them up unprompted.", and
  trim any detail it keeps repeating. If you rewrote a companion's **Memory policy**,
  **Memory-keeping instructions** or **Tidy-up instructions**, they keep your text.
- **Leave alone.** A new list on the Memory page for topics the companion keeps bringing up that
  you'd rather it didn't. Every chat with it is told not to raise them unless you do, from its next
  turn, and the memory model adds nothing more about them. The note above the list is one of the
  companion's own texts, **Leave-alone note**.

- **Pictures keep track of the story.** Before a picture of a moment, Claude now works out the
  scene from the companion's memory and much more of the chat than before: the place, the time, the
  weather and what it has done (still soaked from the rain thirty messages ago), and everyone's
  look, clothes and state. The picture's prompt is written from that, and is told to state every
  detail, since the image model makes up whatever is left unsaid. A profile picture reads the memory
  too. **By hand:** if you rewrote a companion's **Picture instructions**, they keep your text; look
  at the new default to take its "state everything" line.
- **Replies read with feeling.** Reading aloud now follows how each line is said: teasing,
  whispered, angry, tender, and how strongly, judged from the chat around it rather than the reply
  alone. A voice with styles of its own (Serena Multilingual, say) uses them; every other voice is
  steered by speed, pitch and volume. Actions are read as narration. It costs a fraction of a cent
  a reply, the first time it is read, and can be turned off with **Read with feeling** under the
  companion's voice. **Hear it** can now try a voice in any feeling, and the voice finder shows
  which voices have styles.
- **See and correct the scene.** A clapperboard under each message shows how Claude read the moment:
  the setting, who is there, and each line with its feeling. Correct anything and it stays as you
  left it; a picture or reading aloud uses your correction. The picture dialog shows the scene its
  prompt was drawn from, with a way to correct it.
- **One more of Valhalla 2's own words:** **Scene reading instructions**, on the companion's page,
  editable like the rest.

## 0.0.20 — 2026-11-25

- **Nothing changes in use.** The code is reorganised into smaller parts, one per area, so new
  features are quicker and safer to add. Pages, settings, data and costs are exactly as before.
- **Valhalla 2's own words start filled in.** On a companion's page, each box under "Valhalla 2's
  own words" now holds the default text itself, ready to edit, instead of showing it greyed out in
  an empty box. A box you change says "Your own words" and offers "Back to the default"; one you
  leave as the default keeps following it when a later version improves it. Emptying a box still
  means the default is used, and the box now says so.
- **Each companion has its own voice.** A new **Voice** section on a companion's page lists every
  voice Azure offers (over five hundred, in some 150 languages). Type a name, a language or
  "female" to narrow it down, and **Hear it** to listen before choosing; that sample counts
  toward the month's characters like a reply, and hearing the same words again is free. A
  companion that chooses none keeps the server's voice, Ava, as before. After a change, a reply
  already read is read again in the new voice the next time you play it.
- **Clearer reading-aloud errors.** When Azure fails to read a reply, the chat now shows what
  Azure said instead of "Something went wrong".

## 0.0.12 — 2026-11-17

- **Like a reply.** Under every reply from the companion, a heart likes it, and a small box opens
  under it asking what made it good. Saying is optional. With a comment, the like is praise: the
  memory model reads it at its next run and keeps what you liked in `feedback.md`, so later chats
  do more of it. Up to now memory only learned from the replies you rejected. Without a comment,
  the like is just for you, and nothing is sent anywhere. A like is never added to the chat itself,
  so it doesn't change the next reply or what it costs. Tap the heart again to change the comment
  or unlike; memory is told when praise it already has is taken back. The line that tells the
  memory model how to use praise is part of the default **Memory-keeping instructions**: a
  companion whose instructions you rewrote still gets the praise, but not that line, unless you
  add it.

## 0.0.10 — 2026-11-14

- **Copy a message.** Under every message, a copy button puts its words on the clipboard; it shows
  a check mark for a moment when it's done.
- **Pinned moments.** Under every message, a pin button keeps words from it — trimmed to the line
  that matters, with who said them — and sends them word for word in every chat with that
  companion, after its memory. Unlike memory, the memory model never rewrites or condenses them.
  The chat you pinned from sees the pin on its next reply; other chats see it the next time they
  refresh their memory. The companion's **Memory** page lists the pins (30 at most) and unpins
  them. The short note sent above the pins is one of the companion's own texts, **Pinned moments
  note**, which you can rewrite.

## 0.0.8 — 2026-11-14

- **Replies read aloud.** Under every reply, a speaker button reads it aloud with Azure's voice
  Ava, who also speaks Portuguese; while it plays it becomes a stop button. A switch in the chat's
  header (**Aloud** / **Silent**) reads each new reply as it arrives; this browser remembers it,
  and it starts on. Asterisks are dropped, so actions are read like the rest. Each reply is read by
  Azure once and the audio kept on the server, so playing it again costs nothing; under the
  composer you see how many characters Azure has read this month (500,000 are free on Azure's free
  tier).
- **By hand:** before running the installer, put the Azure Speech key in
  `/etc/axis-suite/valhalla2-speech.key`. Valhalla 2 won't start while that file is missing; an
  empty file just means nothing is read aloud. The README's "Installing and data" has the command.

## 0.0.6 — 2026-11-14

- **Pictures.** Under any message, a new picture button asks Claude (Sonnet 5.5) to read the scene
  and write a prompt for it; you can change the prompt, or add a note and have it written again,
  before CivitAI makes the picture. It appears under its message when it is done. Each companion
  has a **Pictures** page, with its profile pictures (made there, from the profile) and its chat
  pictures, each of which can be opened, made again or deleted. Pictures are saved as files on the
  server, not in the database, so the daily backups don't include them. How Claude writes the
  prompts is a new text in each companion's own words, **Picture instructions**.
- **By hand:** before running the installer, put the CivitAI API key in
  `/etc/axis-suite/valhalla2-civitai.key`. Valhalla 2 won't start while that file is missing; an
  empty file just means no pictures. The README's "Installing and data" has the command.

## 0.0.4 — 2026-11-13

- Valhalla 2's first version: a fork of Valhalla, installed beside it with its own address, data
  and API key file, so the two can be compared.
- **Companions replace characters and personas.** A companion is one text box you write however
  you like (tags such as `<personality>` and `<user_persona>` work well): who they are, and who you
  are with them. It is sent exactly as written.
- **Every chat opens with the companion's greeting.**
- **Swipes:** any reply can be written again as often as you like, and you can step back and forth
  between the versions (‹ 2/3 ›). After the fifth, Valhalla 2 asks once why they aren't working; an
  answer is passed on, hidden, to the next versions.
- **Branches, edits and deletes:** continue from any earlier reply and the old line stays one click
  away; edit any message (the old words are kept); delete a message and everything after it.
- **Canon or one-shot:** each chat is part of your story or a standalone scenario. You choose when
  you open it and can change it later.
- Settings belong to the companion, so all its chats use the same, and each companion has a second
  model for its memory. New companions start on Haiku 5.5, with Sonnet 5.5 for memory.
- **Valhalla 2's own words** — the memory policy, the greeting instruction, the rejection note and
  the memory model's instructions — can be rewritten per companion. Inspect shows every hidden part
  of what is sent.
- **Memory.** Every chat feeds one memory per companion: what the character has established about
  herself, your relationship, real-life facts about you, your feedback, open threads, the world and
  the story so far. A second model (Sonnet 5.5 unless you choose another) updates it from the path
  you selected after a chat goes quiet, when you press **Remember now**, when a long chat's oldest
  turns slide out, and before a new chat's greeting. Edited, deleted and abandoned messages are
  taken back out; one-shot chats stay out of the story. A run that fails changes nothing.
- Every chat reads the whole memory, so the companion knows it without looking anything up.
- **The Memory page** shows a companion's files, lets you edit or delete them, shows each file's
  history as a diff and puts back any earlier version, and lists every run of the memory model with
  what it changed and what it cost.
- **Tidy-ups:** every ten updates (or weekly), the memory model merges duplicates, settles
  contradictions and condenses the files; a real clash in the character's canon is listed rather
  than rewritten. **Tidy up now** does it at once.
- **Rebuild from every chat** writes the memory again from scratch, replaying every chat's selected
  path in order — for a better memory model, or new instructions. Nothing changes unless it all
  succeeds, and the old files stay in the history.
- **Daily backups** of the database, kept for 14 days beside it, and **Back up now**.
- Long chats send only their newest part (about 20,000 tokens); a dashed line marks where that
  begins.
- Everything is kept in one database file, `/var/lib/valhalla2/valhalla2.db`.

**By hand:** before the first install, put the Claude API key in
`/etc/axis-suite/valhalla2-anthropic.key`, root-only, the same way as Valhalla's (the command is
under "Installing and data" in Valhalla 2's README). It can be the same key as Valhalla's.

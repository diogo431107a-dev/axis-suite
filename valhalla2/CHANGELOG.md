# Changelog

What changed in Valhalla 2, newest first. Each version is tagged in git as `valhalla2-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

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

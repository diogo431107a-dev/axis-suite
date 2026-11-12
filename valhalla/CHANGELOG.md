# Changelog

What changed in Valhalla, newest first. Each version is tagged in git as `valhalla-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

## 0.0.6 — 2026-11-12

- A turn the API declines no longer breaks the conversation. It stays on the page and in the
  file, but neither it nor your message before it is sent again, so you can say it another way.
- When another model answers a declined turn, the note under it names the model that declined
  and the one that answered (it used to name the same one twice). Turns the API keeps sending to
  that model for a while afterwards are marked too.
- The cost under the composer is closer to the bill: the one-hour cache is charged at its real
  write price, Haiku's dearer rate for prompts over 100K tokens is used, and a declined turn adds
  up every model that tried it, including the older ones a fallback can go to.
- On Haiku, the "let another model answer" checkbox is greyed out, since the API has no fallback
  for Haiku.

## 0.0.4 — 2026-11-12

- Valhalla's first version in the Axis Suite. Write characters and write who you are when you speak
  to them, then hold a conversation that streams in as it is written.
- Sign in through Heimdall, like every module. Each person has their own characters, personas and
  conversations, and nobody else sees them. Someone removed from Heimdall loses their folder the
  next time Valhalla starts.
- Everything is kept as plain files, one folder per person, which you can open and edit. A
  conversation's turns are written one per line and never rewritten.
- Clicking Valhalla at the top left opens an About box with Valhalla's version and the suite's.
- While a reply is being written, a second message to the same conversation (from another tab, or a
  double click) is refused instead of muddling the conversation.
- What a companion sets between asterisks — an action, a glance, the light in a room — is drawn a
  step back from the dialogue, in a fainter italic. The asterisks stay where they were written, and
  so does the turn on disk.
- **Inspect**, in a conversation, shows the exact system prompt that goes to Claude — built by the
  same code that sends it, so there is nothing to take on trust.
- Per-conversation settings: model, effort, longest reply, stop sequences, how long the prompt
  cache is kept, and whether another model may answer a turn this one declines.
- Under the composer: what the conversation now sends, how much of it came from the cache, and
  what the last turn cost.
- A turn the API declines is shown as what it is, with the category and explanation it gave.
- A send that fails saves nothing and gives your words back, so you can simply send it again.
- On Windows, a virus scanner or the search indexer can hold a file open for a moment, and a
  write that lands in that moment used to fail the whole turn. Those writes now wait the lock
  out, and a turn and its reply go into the log in one write — so a failure to stamp the time
  on them no longer reports a message as lost after it was saved and answered.

**By hand:** before the first install, put the Claude API key in
`/etc/axis-suite/valhalla-anthropic.key`, root-only (the command is under "Installing and data" in
Valhalla's README). Without it the service doesn't start. Everyone who can sign in to Heimdall
spends this key, so give the suite a key of its own with a monthly spend limit in the Claude Console.

# Changelog

## Unreleased

- Valhalla's first version. Write characters and write who you are when you speak to them, then
  hold a conversation that streams in as it is written.
- Everything is kept as plain files under `data/`, which you can open and edit. A conversation's
  turns are written one per line and never rewritten.
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

**By hand:** copy `dev.env.example` to `dev.env` and put your `ANTHROPIC_API_KEY` in it before the
first conversation. If you have signed in with `ant auth login`, you can leave it out.

// A reading: one structured request that reads part of a chat and answers in a fixed shape. The
// tags a reply is read aloud with (tone/) and the scene a picture is drawn from (scene/) are each
// one. It goes to the companion's own API: claude/reading.ts or responses/reading.ts.
import type { Effort, Provider } from "../shared/protocol.ts";

export interface ReadingAsk {
  /** The companion's API; a model of the other one is refused, not sent. */
  provider: Provider;
  model: string;
  effort: Effort;
  system: string;
  /** What stays the same for a companion (its profile, its memory), sent first so it is cached. */
  background: string;
  /** The chat up to the moment, and what to do. */
  moment: string;
  /** The JSON schema the answer follows. */
  schema: Record<string, unknown>;
  /** The schema's name on xAI: letters and underscores. */
  name: string;
  /** What is read, for the refusals the page shows: "this moment", "this reply". */
  what: string;
  /** Keeps a companion's readings of one kind on the same cache on xAI. */
  cacheKey: string;
}

export interface ReadingAnswer {
  /** The answer as the model gave it, parsed; the caller checks it. */
  raw: unknown;
  model: string;
  /** In dollars; null when a price is unknown. */
  cost: number | null;
}

/** The function that makes a reading. The server uses readOnItsApi (chat/write.ts); tests their own. */
export type Reader = (ask: ReadingAsk) => Promise<ReadingAnswer>;

// The words the page uses for an entry's source.
import type { Certainty, Question, Source } from "../shared/protocol.ts";
import { QUESTIONS } from "../shared/protocol.ts";

export const SOURCE_LABEL: Record<Source, string> = {
  U: "Unprompted",
  I: "Invited",
  P: "Prompted",
  O: "Observed",
  N: "Inferred",
};

export const SOURCE_LONG: Record<Source, string> = {
  U: "Told unprompted",
  I: "Told when I asked something open",
  P: "Told because I asked",
  O: "I saw it",
  N: "My conclusion",
};

export const TOLD_LABEL: Record<Source, string> = {
  U: "Told at",
  I: "Told at",
  P: "Told at",
  O: "Seen at",
  N: "Concluded at",
};

export const SOURCE_HINT: Record<Source, string> = {
  U: "They brought it up themselves. This builds the spontaneous profile.",
  I: "I asked something open, like “how’s life?”, and they chose what to share. Counts towards the profile, marked as invited.",
  P: "I asked for this. It goes to the prompted ledger and won’t count towards the spontaneous profile.",
  O: "Something I saw. Observed behaviour weighs more than what they say.",
  N: "My conclusion. Shown as my reading, never as their words.",
};

export const CERTAINTY_LABEL: Record<Certainty, string> = { sure: "Sure", fair: "Fairly sure", fuzzy: "Fuzzy memory" };

export const questionLabel = (q: Question): string => QUESTIONS.find((x) => x[0] === q)?.[1] ?? q;

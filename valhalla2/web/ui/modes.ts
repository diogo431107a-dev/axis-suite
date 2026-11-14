// What the two kinds of chat are called on the page.
import type { ChatMode } from "../../shared/protocol.ts";

export const MODE_LABELS: Record<ChatMode, { label: string; hint: string }> = {
  canon: { label: "Canon", hint: "Part of your story together." },
  "one-shot": {
    label: "One-shot",
    hint: "A standalone scenario. Its events stay out of the story; what you learn about each other is kept.",
  },
};

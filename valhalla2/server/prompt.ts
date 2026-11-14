// What goes out: the system prompt and the messages, built from the companion and the selected
// path through the chat.
//
// The prompt cache matches a prefix byte for byte, and the API also binds each thinking block to
// the exact conversation before it. So everything here is deterministic: the same companion and
// the same path always produce exactly the same request — no dates, no ids — and the hidden parts
// (the opener, an instruction a reply was written under) are stored with the reply and sent again
// in the same place every time, so the history only ever grows at its end.
import type Anthropic from "@anthropic-ai/sdk";
import type { CacheTtl, Companion, ContentBlock, Message, PromptView, SentMessage } from "../shared/protocol.ts";
import { blockText } from "../shared/protocol.ts";
import { OPENER } from "../shared/prompts.ts";

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl: CacheTtl };
}

/** The system prompt: the companion's profile as written, with the cache breakpoint after it. */
export function buildSystem(companion: Companion): SystemBlock[] {
  if (!companion.profile) return [];
  return [
    {
      type: "text",
      text: companion.profile,
      cache_control: { type: "ephemeral", ttl: companion.settings.cacheTtl },
    },
  ];
}

/** One message as it goes out. `hidden` marks the ones Valhalla 2 wrote rather than you or the companion. */
export interface Outgoing {
  role: "user" | "assistant" | "system";
  content: ContentBlock[] | string;
  hidden: boolean;
}

/**
 * The messages of the path that go back to the API: all of them except a declined exchange. A
 * refused reply is empty or cut short, and the API takes no empty reply in the middle of a
 * conversation — sending it would break every later turn. Your message that was declined is left
 * out with it, so you can say it another way. Both stay in the chat and on the page.
 */
export function sentPath(path: Message[]): Message[] {
  const kept: Message[] = [];
  for (const message of path) {
    if (message.role === "assistant" && message.reply?.stopReason === "refusal") {
      if (kept.at(-1)?.role === "user") kept.pop();
      continue;
    }
    kept.push(message);
  }
  return kept;
}

/** What a reply still to be written needs before it: its hidden instruction, if it has one. */
export interface NextReply {
  instruction: string | null;
}

/**
 * The messages for a request: the path, then (when a reply is being asked for) its instruction.
 *
 * The API takes no conversation that starts with the assistant, so a reply with nothing before it
 * — the greeting — follows a fixed opener. An instruction goes in as a mid-conversation system
 * message right before the reply it was written for, every time that reply is sent again.
 */
export function outgoing(path: Message[], next?: NextReply): Outgoing[] {
  const out: Outgoing[] = [];
  const beforeReply = (instruction: string | null) => {
    if (out.length === 0) out.push({ role: "user", content: OPENER, hidden: true });
    if (instruction) out.push({ role: "system", content: instruction, hidden: true });
  };
  for (const message of sentPath(path)) {
    if (message.role === "assistant") beforeReply(message.instruction);
    out.push({ role: message.role, content: message.content, hidden: false });
  }
  if (next) beforeReply(next.instruction);
  return out;
}

/** The messages as the Messages API takes them. Stored blocks go back untouched. */
export const asParams = (messages: Outgoing[]): Anthropic.Beta.BetaMessageParam[] =>
  messages.map(
    (message) =>
      ({
        role: message.role,
        content: message.content,
      }) as unknown as Anthropic.Beta.BetaMessageParam,
  );

const textOf = (content: ContentBlock[] | string): string =>
  typeof content === "string" ? content : content.map(blockText).join("");

/** The request as it will be sent, for the Inspect panel. Nothing is assembled out of your sight. */
export function promptView(companion: Companion, path: Message[]): PromptView {
  const messages: SentMessage[] = outgoing(path).map((message) => ({
    role: message.role,
    text: textOf(message.content),
    hidden: message.hidden,
  }));
  return { system: buildSystem(companion), messages, settings: companion.settings };
}

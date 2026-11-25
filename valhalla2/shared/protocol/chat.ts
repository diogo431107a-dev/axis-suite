// Chats and their messages: the tree, the page, pins and likes, Inspect, and the reply stream.
import type { ErrorCode } from "./api.ts";
import type { Companion } from "./companions.ts";
import type { CacheTtl, Settings } from "./models.ts";
import type { Picture } from "./pictures.ts";

/**
 * Whether a chat is part of the companion's story ("canon") or a standalone scenario whose
 * events stay out of it ("one-shot").
 */
export const CHAT_MODES = ["canon", "one-shot"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export interface Chat {
  id: string;
  companionId: string;
  title: string;
  mode: ChatMode;
  /** The end of the path through the chat that is "what happened". Null in an empty chat. */
  activeLeafId: number | null;
  createdAt: string;
  lastActivityAt: string;
}

/**
 * One content block exactly as the API returned it. Kept verbatim, never flattened to a string:
 * thinking blocks are bound to the model and the conversation, so they have to go back unchanged.
 */
export type ContentBlock = { readonly type: string } & Readonly<Record<string, unknown>>;

/** The text of a block, or "" for a block that carries none (a thinking block, say). */
export const blockText = (block: ContentBlock): string => (typeof block.text === "string" ? block.text : "");

export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  /** Of those written, how many went into the 1-hour cache, which costs more to write. */
  cache_creation_1h_input_tokens?: number | null;
}

/** One model's attempt at a turn: the one that declined, and the one that answered. */
export interface Attempt extends TurnUsage {
  model: string | null;
}

export interface RefusalDetails {
  category: string | null;
  explanation: string | null;
}

/** What the API said about a reply, besides its content. Assistant messages only. */
export interface ReplyDetails {
  model: string;
  stopReason: string | null;
  stopDetails: RefusalDetails | null;
  usage: TurnUsage | null;
  /** Set when a fallback model answered instead of the companion's model. */
  servedBy: string | null;
  /** The model that declined this turn before the fallback answered, when that happened now. */
  declinedBy: string | null;
  /** Every attempt the API made at this turn, when there was more than one. `usage` is only the last. */
  attempts: Attempt[] | null;
}

/**
 * One message in a chat. A chat is a tree: messages under the same parent are swipes (replies)
 * or branches (your messages), and only one path through it is sent to the model.
 */
export interface Message {
  id: number;
  parentId: number | null;
  role: "user" | "assistant";
  content: ContentBlock[];
  /**
   * A hidden instruction the reply was written under — the greeting instruction, or why you
   * rejected the versions before it. Sent again, in the same place, every time this path is sent.
   */
  instruction: string | null;
  isGreeting: boolean;
  at: string;
  editedAt: string | null;
  reply: ReplyDetails | null;
}

/** A message on the selected path, with its alternatives. */
export interface PathEntry {
  message: Message;
  /** This message and its alternatives (same parent, same role), oldest first. */
  siblings: number[];
  /** Whether to ask now why these replies keep being rejected. At most once per message. */
  ask: boolean;
}

export interface ChatPage {
  chat: Chat;
  companion: Companion;
  path: PathEntry[];
  /** The first message still sent to the model; those before it have slid out (into memory). */
  windowStart: number | null;
  /** Whether the chat has anything the companion's memory doesn't have yet. */
  memoryPending: boolean;
  /** The pictures made from messages on the selected path, oldest first. */
  pictures: Picture[];
  /** The messages on the selected path with something pinned from them. */
  pinned: number[];
  /** The replies on the selected path you liked, with what you said about them. */
  liked: Liked[];
}

/** A chat as the list shows it: enough to name it without reading its messages. */
export interface ChatSummary {
  id: string;
  title: string;
  mode: ChatMode;
  companionId: string;
  companionName: string;
  lastActivityAt: string;
}

/** A reply you liked, as the chat page shows it. A null comment: liked only for you. */
export interface Liked {
  messageId: number;
  comment: string | null;
}

/**
 * A moment you pinned: words from a chat kept exactly as they are, and sent in every chat with the
 * companion, beside its memory. The memory model never changes them.
 */
export interface Pin {
  id: number;
  companionId: string;
  /** Where it came from; null once that chat (or message) is deleted. The pin stays. */
  chatId: string | null;
  messageId: number | null;
  /** Who said it, as the model reads it: the companion's name, or yours in the story. */
  speaker: string;
  /** The chat's title when it was pinned. */
  chatTitle: string;
  text: string;
  createdAt: string;
}

/** One message as it goes out, for the Inspect panel: its text, and whether you ever see it. */
export interface SentMessage {
  role: "user" | "assistant" | "system";
  text: string;
  /** Written by Valhalla 2 rather than said by you or the companion. */
  hidden: boolean;
}

/** What `GET /api/chats/:id/prompt` answers: the request as it will be sent. */
export interface PromptView {
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl: CacheTtl } }[];
  messages: SentMessage[];
  settings: Settings;
}

export interface TokenView {
  inputTokens: number;
  /** The model's context window, as the Models API reports it, or null when it doesn't say. */
  contextWindow: number | null;
}

/** The events the server sends while a reply is being written. */
export type StreamEvent =
  | { type: "start" }
  /** The companion's memory is being updated first; the reply waits for it. */
  | { type: "remembering" }
  | { type: "thinking" }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; error: string; code?: ErrorCode };

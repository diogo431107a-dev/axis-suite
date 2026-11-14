// The API's wire format, used by the server and the page.

export const LIMITS = {
  /** A companion's name, shown in the list. Never sent to the model. */
  name: 80,
  /** A companion's profile: the one text box the model reads about who it is, and who you are. */
  profile: 60_000,
  /** One of a companion's own prompt texts (the greeting instruction, the rejection note…). */
  prompt: 8_000,
  /** One message you send, or an edit of one. */
  message: 50_000,
  /** Why you keep rejecting a reply. */
  reason: 2_000,
  /** A chat's title. */
  title: 120,
  stopSequences: 4,
  stopSequence: 80,
  /** How many of each Valhalla 2 keeps track of. */
  companions: 500,
  chats: 5_000,
  /** The reply length you can ask for. Replies stream, so a long ceiling costs nothing. */
  minTokens: 256,
  maxTokens: 64_000,
} as const;

/**
 * How much effort the model puts into a reply. This replaces the temperature slider other
 * companion apps have: the current models reject `temperature`, `top_p` and `top_k` outright.
 * Dialogue usually wants "low" — it answers sooner and stays in voice.
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** How long the prompt cache holds the profile and the chat so far. */
export const CACHE_TTLS = ["5m", "1h"] as const;
export type CacheTtl = (typeof CACHE_TTLS)[number];

/**
 * The models offered in the picker, with what they cost per million tokens. Any other model id
 * can be typed in by hand — Valhalla 2 sends what you choose and does not second-guess it.
 * Prices as published on 2026-11-03.
 */
export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", input: 4.0, output: 20.0, cacheRead: 0.2 },
  { id: "claude-fable-5-2", label: "Fable 5.2", input: 8.0, output: 40.0, cacheRead: 0.2 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", input: 2.0, output: 10.0, cacheRead: 0.1 },
  // Haiku has two rates: these, and five times as much for a prompt over 100K tokens (see PRICES).
  { id: "claude-haiku-5-5", label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
] as const;

/** Whether the API can hand a declined turn to another model. It has no fallback for Haiku. */
export const hasFallback = (model: string): boolean => !model.startsWith("claude-haiku-");

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** A dearer rate for a prompt longer than `over` tokens. */
  long?: { over: number; input: number; output: number; cacheRead: number };
}

/**
 * What every model a turn can come from costs, per million tokens: the ones in the picker, and
 * the older ones the API may hand a declined turn to. Prices as published on 2026-11-03.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  ...Object.fromEntries(MODELS.map(({ id, input, output, cacheRead }) => [id, { input, output, cacheRead }])),
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    long: { over: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  "claude-opus-5": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheRead: 0.2 },
};

/**
 * What a new companion starts from when the server names no models of its own. The server's
 * CHAT_MODEL and MEMORY_MODEL replace the two models; /api/health hands the result to the page.
 */
export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5-5",
  memoryModel: "claude-sonnet-5-5",
  maxTokens: 4096,
  effort: "low",
  stopSequences: [],
  cacheTtl: "1h",
  fallbacks: true,
};

/** What Valhalla 2 sends with a request, besides the profile. One set per companion. */
export interface Settings {
  /** The model that answers in character. */
  model: string;
  /** The model that keeps the companion's memory up to date after a chat. */
  memoryModel: string;
  maxTokens: number;
  effort: Effort;
  /** Text that ends a reply early — useful to stop the model writing your lines for you. */
  stopSequences: string[];
  cacheTtl: CacheTtl;
  /**
   * Whether the API may answer on a fallback model when a safety classifier declines this one.
   * Valhalla 2 adds no filter of its own either way; this only decides whether a declined turn
   * gets a second chance inside the same call.
   */
  fallbacks: boolean;
}

/**
 * The texts Valhalla 2 itself adds to what the model reads. Each companion can rewrite any of them;
 * one left out uses the default in shared/prompts.ts.
 */
export const PROMPT_KEYS = ["greeting", "rejection"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];
export type Prompts = Partial<Record<PromptKey, string>>;

/**
 * Someone you talk to. The profile is one text box you write however you like — XML tags such as
 * <personality> or <user_persona> work well — and it is sent exactly as written.
 */
export interface Companion {
  id: string;
  /** For the list on the page only; the model reads the profile, not this. */
  name: string;
  profile: string;
  settings: Settings;
  prompts: Prompts;
  createdAt: string;
  updatedAt: string;
}

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

export interface Health {
  /** Whether the server has a Claude API key to send with. */
  apiKey: boolean;
  /** What a new companion starts from. */
  defaults: Settings;
}

/** The events the server sends while a reply is being written. */
export type StreamEvent =
  | { type: "start" }
  | { type: "thinking" }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; error: string; code?: ErrorCode };

export const ERROR_CODES = ["invalid", "not-found", "conflict", "too-many", "no-credential", "api", "busy"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: string;
  code?: ErrorCode;
}

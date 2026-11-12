// The API's wire format, used by the server and the page.

export const LIMITS = {
  /** A character's or persona's name. */
  name: 80,
  /** One free-text field of a definition: personality, appearance, behavior. */
  field: 20_000,
  /** One message you send. */
  message: 50_000,
  /** A conversation's title. */
  title: 120,
  stopSequences: 4,
  stopSequence: 80,
  /** How many of each Valhalla keeps track of. */
  characters: 500,
  personas: 500,
  conversations: 5_000,
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

/** How long the prompt cache holds the character, the persona and the conversation so far. */
export const CACHE_TTLS = ["5m", "1h"] as const;
export type CacheTtl = (typeof CACHE_TTLS)[number];

/**
 * The models offered in the picker, with what they cost per million tokens. Any other model id
 * can be typed in by hand — Valhalla sends what you choose and does not second-guess it.
 * Prices as published on 2026-11-03.
 */
export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", input: 4.0, output: 20.0, cacheRead: 0.2 },
  { id: "claude-fable-5-2", label: "Fable 5.2", input: 8.0, output: 40.0, cacheRead: 0.2 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", input: 2.0, output: 10.0, cacheRead: 0.1 },
  // Haiku's cache-read price is not published separately; the general rule is a tenth of input.
  { id: "claude-haiku-5-5", label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
] as const;

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5-5",
  maxTokens: 4096,
  effort: "low",
  stopSequences: [],
  cacheTtl: "1h",
  fallbacks: true,
};

/** What Valhalla sends with a request, besides the character and the persona. */
export interface Settings {
  model: string;
  maxTokens: number;
  effort: Effort;
  /** Text that ends a reply early — useful to stop the model writing your lines for you. */
  stopSequences: string[];
  cacheTtl: CacheTtl;
  /**
   * Whether the API may answer on a fallback model when a safety classifier declines this one.
   * Valhalla adds no filter of its own either way; this only decides whether a declined turn
   * gets a second chance inside the same call.
   */
  fallbacks: boolean;
}

/** Someone you talk to. You write all of it; Valhalla adds no words of its own. */
export interface Character {
  id: string;
  name: string;
  personality: string;
  appearance: string;
  behavior: string;
  /** The starting settings for conversations with them. */
  settings: Settings;
  createdAt: string;
  updatedAt: string;
}

/** Who you are in a conversation: a servant before a king, a wolf in the pack. */
export interface Persona {
  id: string;
  name: string;
  description: string;
  appearance: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  characterId: string;
  personaId: string;
  settings: Settings;
  createdAt: string;
  updatedAt: string;
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
}

export interface RefusalDetails {
  category: string | null;
  explanation: string | null;
}

/** One turn in a conversation. The log is append-only: a turn is written once and never edited. */
export interface Turn {
  id: string;
  at: string;
  role: "user" | "assistant";
  content: ContentBlock[];
  /** Assistant turns only. */
  model?: string;
  stopReason?: string | null;
  stopDetails?: RefusalDetails | null;
  usage?: TurnUsage | null;
  /** Set when a fallback model answered after this turn's model declined. */
  servedBy?: string | null;
}

/** A conversation as the list rail shows it: enough to name it without reading its log. */
export interface ConversationSummary {
  id: string;
  title: string;
  characterId: string;
  characterName: string;
  personaId: string;
  personaName: string;
  updatedAt: string;
}

export interface ConversationPage {
  conversation: Conversation;
  character: Character;
  persona: Persona;
  turns: Turn[];
}

/** What `GET /api/conversations/:id/prompt` answers: the request as it will be sent. */
export interface PromptView {
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl: CacheTtl } }[];
  settings: Settings;
  turns: number;
}

export interface TokenView {
  inputTokens: number;
  /** The model's context window, as the Models API reports it, or null when it doesn't say. */
  contextWindow: number | null;
}

/** The events the server sends while a reply is being written. */
export type StreamEvent =
  | { type: "start"; turn: Turn }
  | { type: "thinking" }
  | { type: "delta"; text: string }
  | { type: "done"; turn: Turn }
  | { type: "error"; error: string; code?: ErrorCode };

export const ERROR_CODES = ["invalid", "not-found", "conflict", "too-many", "no-credential", "api", "busy"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: string;
  code?: ErrorCode;
}

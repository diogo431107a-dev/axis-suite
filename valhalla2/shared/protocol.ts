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
  /** A picture's prompt, and its negative prompt. */
  picturePrompt: 4_000,
  /** What you add when asking for a picture: "at sunset", "from behind". */
  pictureHint: 1_000,
  /** The one line under a picture in the gallery. */
  pictureCaption: 300,
  /** How many pictures one companion keeps. */
  pictures: 5_000,
  /** How many pictures one person can have being made at once. */
  picturesAtOnce: 3,
  /** A pinned moment: the words kept, and who said them. */
  pinText: 500,
  pinSpeaker: 80,
  /** How many moments one companion keeps pinned. Every one is sent in every chat. */
  pins: 30,
  /** What you say you liked about a reply. */
  likeComment: 1_000,
} as const;

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

/** Profile pictures are made from the companion page; chat pictures from a message. */
export const PICTURE_KINDS = ["profile", "chat"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** The sizes SDXL was trained on, one per orientation. */
export const PICTURE_SIZES: Readonly<Record<Orientation, { width: number; height: number }>> = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
};

/** A picture's prompt, written by Claude and yours to change before the picture is made. */
export interface PictureDraft {
  prompt: string;
  negativePrompt: string;
  orientation: Orientation;
  /** One plain line saying what the picture shows, for the gallery. */
  caption: string;
}

/** What writing a prompt answers: the draft, and what asking Claude for it cost. */
export interface PictureDraftReply extends PictureDraft {
  /** In dollars, at the published prices; null when a price is unknown. */
  cost: number | null;
}

/** What a picture is made from, besides its prompt. */
export interface PictureParams {
  model: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  seed: number;
}

/** A picture of a companion, made or being made. Its file is GET /api/pictures/:id/file. */
export interface Picture extends PictureDraft {
  id: string;
  companionId: string;
  kind: PictureKind;
  /** The chat and message a chat picture was made from; null once that chat is deleted. */
  chatId: string | null;
  chatTitle: string | null;
  messageId: number | null;
  params: PictureParams;
  status: "working" | "done" | "failed";
  error: string | null;
  createdAt: string;
}

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
export const PROMPT_KEYS = [
  "memoryPolicy",
  "pins",
  "greeting",
  "rejection",
  "consolidation",
  "cleanup",
  "picture",
] as const;
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

/** One of a companion's memory files, as the list shows it. */
export interface MemoryFileInfo {
  /** Relative to /memories: "story/recent.md". */
  path: string;
  /** In bytes. */
  size: number;
  /** The largest the file may grow, in bytes. */
  cap: number;
  updatedAt: string;
}

/** One run of the memory model. */
export interface MemoryRunInfo {
  id: number;
  kind: string;
  chatId: string | null;
  chatTitle: string | null;
  model: string;
  /** Null while it runs. */
  ok: boolean | null;
  error: string | null;
  /** What the model said it changed. */
  summary: string | null;
  /** In dollars, at the published prices; null when a price is unknown. */
  cost: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface MemoryPage {
  companionId: string;
  files: MemoryFileInfo[];
  maxFiles: number;
  runs: MemoryRunInfo[];
  /** Whether the memory model is working on this companion right now. */
  busy: boolean;
  /** Whether that work is a rebuild from every chat. */
  rebuilding: boolean;
  /** How many chats a rebuild would read. */
  chats: number;
  /** The database's daily backups, newest first. */
  backups: { day: string; bytes: number }[];
  /** The moments pinned for this companion, oldest first, as they are sent. */
  pins: Pin[];
}

export interface MemoryFileView {
  path: string;
  content: string;
  cap: number;
}

/** One change to a memory file. */
export interface MemoryVersionInfo {
  id: number;
  op: string;
  source: string;
  at: string;
  /** In bytes; null when the change deleted the file. */
  size: number | null;
}

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** How a run of the memory model for one chat ended. */
export type RunOutcome =
  | { kind: "nothing"; reason: string }
  | { kind: "done"; runId: number; summary: string }
  | { kind: "failed"; runId: number; error: string };

/** A version of a file, and what it changed from the one before. */
export interface MemoryVersionView {
  version: MemoryVersionInfo;
  content: string | null;
  diff: DiffLine[];
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
  /** Whether the server has a CivitAI key, so pictures can be made. */
  pictures: boolean;
  /** Whether the server has an Azure Speech key, so replies can be read aloud. */
  speech: boolean;
  /** What a new companion starts from. */
  defaults: Settings;
}

/** A reply read aloud: where its audio is, and how much Azure has read this month. */
export interface SpeechReply {
  url: string;
  /** Characters Azure was asked to read this calendar month (UTC), by everyone on this server. */
  monthChars: number;
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

export const ERROR_CODES = ["invalid", "not-found", "conflict", "too-many", "no-credential", "api", "busy"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: string;
  code?: ErrorCode;
}

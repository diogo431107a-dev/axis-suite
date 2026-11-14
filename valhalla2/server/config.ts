// The settings that come from the environment: dev.env in development, the service unit on a
// server. Each has a default, so none of them has to be set.
import { DEFAULT_SETTINGS, type Settings } from "../shared/protocol.ts";

function count(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    console.error(`${name}=${raw} isn't a whole number of at least ${min}; using ${fallback}`);
    return fallback;
  }
  return value;
}

const modelFrom = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;

export const config = {
  /** What a new companion starts from: CHAT_MODEL answers in character, MEMORY_MODEL keeps memory. */
  defaults: {
    ...DEFAULT_SETTINGS,
    model: modelFrom("CHAT_MODEL", DEFAULT_SETTINGS.model),
    memoryModel: modelFrom("MEMORY_MODEL", DEFAULT_SETTINGS.memoryModel),
  } satisfies Settings,
  /** After this many swipes on one reply, ask why the replies aren't working. */
  swipeAsk: count("VALHALLA_SWIPE_ASK", 5),
  memory: memoryLimits(),
  /** About how many tokens of the chat are sent; older turns slide out, a chunk at a time. */
  windowTokens: count("VALHALLA_WINDOW_TOKENS", 20_000, 1_000),
  /** How many exchanges slide out at once, so the cached prefix changes rarely. */
  windowChunk: count("VALHALLA_WINDOW_CHUNK", 10),
  /** Minutes without activity before a chat's new messages are folded into memory. */
  idleMinutes: count("VALHALLA_IDLE_MINUTES", 30),
  /** The most requests one consolidation may make. */
  memoryIterations: count("VALHALLA_MEMORY_ITERATIONS", 16),
};

/** The size limits of a companion's memory. */
export interface MemoryLimits {
  /** The largest a file may be, in bytes. */
  fileBytes: number;
  /** The largest story/recent.md and story/arcs.md may be. */
  storyBytes: number;
  /** How many files a companion may have. */
  files: number;
  /** The most characters one `view` shows; longer files are read in ranges. */
  viewChars: number;
}

function memoryLimits(): MemoryLimits {
  return {
    fileBytes: count("VALHALLA_MEMORY_FILE_KB", 8) * 1024,
    storyBytes: count("VALHALLA_MEMORY_STORY_KB", 16) * 1024,
    files: count("VALHALLA_MEMORY_FILES", 20),
    viewChars: 16_000,
  };
}

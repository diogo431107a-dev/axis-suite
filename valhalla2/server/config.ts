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
  /**
   * What a new Claude companion starts from: CHAT_MODEL answers in character, MEMORY_MODEL keeps
   * memory, TONE_MODEL works out how a reply is said aloud, SCENE_MODEL a moment for a picture.
   */
  defaults: {
    ...DEFAULT_SETTINGS,
    model: modelFrom("CHAT_MODEL", DEFAULT_SETTINGS.model),
    memoryModel: modelFrom("MEMORY_MODEL", DEFAULT_SETTINGS.memoryModel),
    toneModel: modelFrom("TONE_MODEL", DEFAULT_SETTINGS.toneModel),
    sceneModel: modelFrom("SCENE_MODEL", DEFAULT_SETTINGS.sceneModel),
  } satisfies Settings,
  /** After this many swipes on one reply, ask why the replies aren't working. */
  swipeAsk: count("VALHALLA_SWIPE_ASK", 5),
  memory: memoryLimits(),
  /** About how many tokens of the chat are sent; older turns slide out, a chunk at a time. */
  windowTokens: count("VALHALLA_WINDOW_TOKENS", 20_000, 1_000),
  /** The same, for a Grok companion with memory: more of the chat word for word, at Grok's cache rate. */
  grokWindowTokens: count("VALHALLA_GROK_WINDOW_TOKENS", 60_000, 1_000),
  /** How many exchanges slide out at once, so the cached prefix changes rarely. */
  windowChunk: count("VALHALLA_WINDOW_CHUNK", 10),
  /** Minutes without activity before a chat's new messages are folded into memory. */
  idleMinutes: count("VALHALLA_IDLE_MINUTES", 30),
  /** The most requests one consolidation may make. */
  memoryIterations: count("VALHALLA_MEMORY_ITERATIONS", 16),
  /** When a companion's memory is tidied: after this many consolidations, or this many days. */
  cleanup: { every: count("VALHALLA_CLEANUP_EVERY", 10), days: count("VALHALLA_CLEANUP_DAYS", 7) },
  /** How many daily backups of the database are kept. */
  backupsKept: count("VALHALLA_BACKUPS_KEPT", 14),
  pictures: {
    /** The CivitAI model that makes pictures, as an AIR. */
    model: modelFrom("PICTURE_MODEL", "urn:air:sdxl:checkpoint:civitai:827184@2883731"),
    /** The Claude model that writes a picture's prompt. */
    promptModel: modelFrom("PICTURE_PROMPT_MODEL", "claude-sonnet-5-5"),
    /** The xAI image model a companion on Grok Imagine makes its pictures with. */
    grokModel: modelFrom("GROK_PICTURE_MODEL", "grok-imagine-image-2.0"),
  },
  scene: {
    /** About how many tokens of the chat, up to the moment, the scene model reads to understand it. */
    tokens: count("VALHALLA_SCENE_TOKENS", 12_000, 500),
  },
  speech: {
    /** The Azure region of the Speech resource the key belongs to. */
    region: modelFrom("SPEECH_REGION", "brazilsouth"),
    /**
     * The voice that reads the replies of a companion that names none. Multilingual, so it reads
     * Portuguese too. A Grok voice is `grok:` and its name, such as `grok:eve`.
     */
    voice: modelFrom("SPEECH_VOICE", "en-US-AvaMultilingualNeural"),
  },
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

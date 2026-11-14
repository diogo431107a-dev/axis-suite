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
};

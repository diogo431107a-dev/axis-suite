// What a chat shows the model of the companion's memory.
//
// All of it: every memory file, whole, after the memory policy, then the moments you pinned
// (pins.ts) when there are any, then a line saying whether the chat is canon or a one-shot. The caps keep it small enough (a few thousand tokens), and it sits
// in the cached part of the prompt, so re-sending it costs a cache read.
//
// It is a snapshot, frozen in `chats.memory_snapshot`. The API ties the companion's thinking, and
// the prompt cache, to the exact system prompt; if memory changed under a chat mid-conversation
// (another chat finishing, this one being filed) every turn after would lose both. So a chat
// keeps the memory it started with and takes a fresh one only when its prefix changes anyway:
// when its oldest turns slide out of the window (history.ts), when its mode changes, and when it
// has sat longer than the cache lasts.
import type { DatabaseSync } from "node:sqlite";
import type { ChatMode, Companion, Pin } from "../../shared/protocol.ts";
import { CHAT_MODE_LINES, promptOf } from "../../shared/prompts.ts";
import { pinsOf } from "../pins.ts";
import { renderFiles } from "./render.ts";
import type { Memory, MemoryFile } from "./store.ts";

/**
 * The pinned moments, word for word, one per line with who said it and in which chat. A pin that
 * runs over several lines keeps them, indented under its own.
 */
export function renderPins(companion: Companion, pins: Pin[]): string {
  const lines = pins.map(
    (pin) => `- [${pin.speaker}, in the chat "${pin.chatTitle}"]: "${pin.text.replaceAll("\n", "\n  ")}"`,
  );
  return `<pinned_moments>\n${promptOf(companion, "pins")}\n${lines.join("\n")}\n</pinned_moments>`;
}

/** The memory block of the system prompt: memory, then any pinned moments, then the chat's mode. */
export function renderMemory(companion: Companion, files: MemoryFile[], mode: ChatMode, pins: Pin[] = []): string {
  return [
    promptOf(companion, "memoryPolicy"),
    `<memory>\n${renderFiles(files)}\n</memory>`,
    ...(pins.length > 0 ? [renderPins(companion, pins)] : []),
    CHAT_MODE_LINES[mode],
  ].join("\n\n");
}

const TTL_MS = { "5m": 5 * 60_000, "1h": 60 * 60_000 } as const;

/** Takes a fresh snapshot of the companion's memory for a chat, and keeps it there. */
export function refreshSnapshot(db: DatabaseSync, memory: Memory, chatId: string, companion: Companion): string {
  const { mode } = db.prepare("SELECT mode FROM chats WHERE id = ?").get(chatId) as { mode: ChatMode };
  const snapshot = renderMemory(companion, memory.files(companion.id), mode, pinsOf(db, companion.id));
  db.prepare("UPDATE chats SET memory_snapshot = ? WHERE id = ?").run(snapshot, chatId);
  return snapshot;
}

/**
 * The memory a chat's next request carries: its snapshot, or a fresh one when it has none yet or
 * has sat longer than the prompt cache lasts (nothing cached is lost by changing it then).
 */
export function snapshotFor(
  db: DatabaseSync,
  memory: Memory,
  chatId: string,
  companion: Companion,
  now = Date.now(),
): string {
  const row = db.prepare("SELECT memory_snapshot, last_activity_at FROM chats WHERE id = ?").get(chatId) as {
    memory_snapshot: string | null;
    last_activity_at: string;
  };
  const idle = now - Date.parse(row.last_activity_at);
  if (row.memory_snapshot !== null && idle < TTL_MS[companion.settings.cacheTtl]) return row.memory_snapshot;
  return refreshSnapshot(db, memory, chatId, companion);
}

/** The snapshot as it stands, or as it would be taken now, without keeping anything. For Inspect. */
export function peekSnapshot(db: DatabaseSync, memory: Memory, chatId: string, companion: Companion): string {
  const row = db.prepare("SELECT memory_snapshot, mode FROM chats WHERE id = ?").get(chatId) as {
    memory_snapshot: string | null;
    mode: ChatMode;
  };
  return row.memory_snapshot ?? renderMemory(companion, memory.files(companion.id), row.mode, pinsOf(db, companion.id));
}

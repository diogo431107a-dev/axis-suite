// A companion's memory: its files, their versions, and the runs of the memory model.
import type { Pin } from "./chat.ts";

/** A topic you asked the companion to leave alone: it doesn't bring it up unless you do. */
export interface QuietTopic {
  id: number;
  text: string;
  createdAt: string;
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
  /** The topics it leaves alone, oldest first, as they are sent. */
  quiet: QuietTopic[];
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

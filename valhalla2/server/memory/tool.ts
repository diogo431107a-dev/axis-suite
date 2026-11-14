// The memory tool, as the model uses it, backed by the database instead of a folder.
//
// The model asks for view, create, str_replace, insert, delete and rename on paths under
// /memories; this file carries them out against one space of memory_files (see store.ts) and
// answers with the strings the memory-tool documentation gives, word for word, so the model reads
// what it expects. A failure is thrown as a ToolError, which the SDK's tool runner sends back
// with `is_error: true`. Each command is one transaction — a failure changes nothing — and every
// command, done or refused, is written to memory_ops.
//
// Only a run of the memory model writes memory this way. A chat never gets the tool at all: its
// memory is in its system prompt (inject.ts), so a reply that is later swiped away, edited or
// left on another branch can never have changed what the companion remembers.
import type { DatabaseSync } from "node:sqlite";
import type Anthropic from "@anthropic-ai/sdk";
import { betaMemoryTool, type MemoryToolHandlers } from "@anthropic-ai/sdk/helpers/beta/memory";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import type { ChatMode } from "../../shared/protocol.ts";
import type { MemoryLimits } from "../config.ts";
import { transaction } from "../db.ts";
import { absolute, PathError, relativePath, within } from "./paths.ts";
import { bytesOf, humanSize, MemoryError, type Change, type Memory } from "./store.ts";

type Command = Anthropic.Beta.BetaMemoryTool20250818Command;

export interface ToolOptions {
  db: DatabaseSync;
  memory: Memory;
  limits: MemoryLimits;
  /** Where the commands read and write: a companion's id, or a scratch space. */
  space: string;
  /** What each change is recorded as coming from: consolidate:<chat>, cleanup, rebuild. */
  source: string;
  runId: number | null;
  chatId: string | null;
  /**
   * The mode of the chat being filed. A one-shot is a standalone scenario, so its events may not
   * reach the story: world.md and story/ can be read but not written.
   */
  mode: ChatMode;
}

/** Whether a one-shot chat may not write here. */
const storyOnly = (path: string): boolean => path === "world.md" || within(path, "story");

const numbered = (lines: string[], first: number): string =>
  lines.map((line, at) => `${String(first + at).padStart(6)}\t${line}`).join("\n");

/** The commands, carried out. Each returns what the model is told, or throws a ToolError. */
export function memoryCommands(options: ToolOptions) {
  const { db, memory, limits, space, source, runId, mode } = options;
  const change = (op: string): Change => ({ op, source, runId });

  const path = (raw: unknown): string => {
    try {
      return relativePath(raw);
    } catch (err) {
      if (err instanceof PathError) throw new ToolError(err.message);
      throw err;
    }
  };

  const writable = (relative: string): void => {
    if (relative === "") throw new ToolError(`Error: ${absolute("")} itself can't be changed`);
    if (mode === "one-shot" && storyOnly(relative)) {
      throw new ToolError(
        `Error: ${absolute(relative)} is read-only for this chat. It is a standalone one-shot scenario, so its events ` +
          "stay out of world.md and story/. Record only what it shows about the character, the relationship, the user " +
          "and their feedback.",
      );
    }
  };

  /** Runs a change in one transaction, turning a refused change into what the model is told. */
  const changing = <T>(work: () => T): T => {
    try {
      return transaction(db, work);
    } catch (err) {
      if (err instanceof MemoryError) throw new ToolError(err.message);
      throw err;
    }
  };

  function listing(dir: string): string {
    const files = memory.under(space, dir);
    const depth = (p: string) => (dir === "" ? p : p.slice(dir.length + 1)).split("/").length;
    const lines = [`${humanSize(files.reduce((sum, file) => sum + bytesOf(file.content), 0))}\t${absolute(dir)}`];
    const entries = new Map<string, number>();
    for (const file of files) {
      const rest = (dir === "" ? file.path : file.path.slice(dir.length + 1)).split("/");
      // A file one or two levels down, and every directory on the way to it.
      for (let level = 1; level <= Math.min(2, rest.length); level++) {
        const entry = [dir, ...rest.slice(0, level)].filter(Boolean).join("/");
        if (entry.split("/").some((segment) => segment.startsWith("."))) continue;
        entries.set(entry, (entries.get(entry) ?? 0) + (depth(file.path) >= level ? bytesOf(file.content) : 0));
      }
    }
    for (const [entry, size] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${humanSize(size)}\t${absolute(entry)}`);
    }
    return (
      `Here're the files and directories up to 2 levels deep in ${absolute(dir)}, excluding hidden items and node_modules:\n` +
      lines.join("\n")
    );
  }

  const handlers: MemoryToolHandlers = {
    view(command) {
      const relative = path(command.path);
      const file = relative === "" ? undefined : memory.read(space, relative);
      if (!file) {
        if (memory.isDirectory(space, relative)) return listing(relative);
        throw new ToolError(`The path ${absolute(relative)} does not exist. Please provide a valid path.`);
      }
      const lines = file.content.replace(/\n$/, "").split("\n");
      if (lines.length > 999_999) {
        throw new ToolError(`File ${absolute(relative)} exceeds maximum line limit of 999,999 lines.`);
      }
      let first = 1;
      let shown = lines;
      if (command.view_range) {
        const [start, end] = command.view_range;
        const last = end === -1 ? lines.length : (end ?? lines.length);
        if (!start || start < 1 || start > lines.length || last < start || last > lines.length) {
          throw new ToolError(
            `Error: Invalid \`view_range\` parameter: [${command.view_range.join(", ")}]. ` +
              `The file has ${lines.length} lines; use [start, end] with 1 <= start <= end <= ${lines.length}, or end -1.`,
          );
        }
        first = start;
        shown = lines.slice(start - 1, last);
      }
      let text = numbered(shown, first);
      if (text.length > limits.viewChars) {
        // Cut at a whole line, and say how to read the rest.
        const kept: string[] = [];
        let size = 0;
        for (const line of shown) {
          if (size + line.length + 8 > limits.viewChars) break;
          kept.push(line);
          size += line.length + 8;
        }
        const next = first + kept.length;
        text = `${numbered(kept, first)}\n[Shown up to line ${next - 1} of ${lines.length}. View the rest with view_range: [${next}, -1].]`;
      }
      return `Here's the content of ${absolute(relative)} with line numbers:\n${text}`;
    },

    create(command) {
      const relative = path(command.path);
      writable(relative);
      // The tool's own description tells the model `create` creates or overwrites a file, so an
      // existing file is replaced rather than refused — the way it rewrites a file it condensed.
      changing(() => memory.write(space, relative, command.file_text, change("create")));
      return `File created successfully at: ${absolute(relative)}`;
    },

    str_replace(command) {
      const relative = path(command.path);
      writable(relative);
      const file = memory.read(space, relative);
      if (!file)
        throw new ToolError(`Error: The path ${absolute(relative)} does not exist. Please provide a valid path.`);
      const { old_str: before, new_str: after = "" } = command;
      const found: number[] = [];
      for (
        let at = file.content.indexOf(before);
        at !== -1 && before !== "";
        at = file.content.indexOf(before, at + 1)
      ) {
        found.push(file.content.slice(0, at).split("\n").length);
      }
      if (found.length === 0) {
        throw new ToolError(
          `No replacement was performed, old_str \`${before}\` did not appear verbatim in ${absolute(relative)}.`,
        );
      }
      if (found.length > 1) {
        throw new ToolError(
          `No replacement was performed. Multiple occurrences of old_str \`${before}\` in lines: ${found.join(", ")}. Please ensure it is unique`,
        );
      }
      const at = file.content.indexOf(before);
      const content = file.content.slice(0, at) + after + file.content.slice(at + before.length);
      changing(() => memory.write(space, relative, content, change("str_replace")));
      // A few lines around the change, so the model sees it landed where it meant.
      const lines = content.replace(/\n$/, "").split("\n");
      const line = found[0]!;
      const from = Math.max(1, line - 3);
      const to = Math.min(lines.length, line + after.split("\n").length + 2);
      return `The memory file has been edited.\n${numbered(lines.slice(from - 1, to), from)}`;
    },

    insert(command) {
      const relative = path(command.path);
      writable(relative);
      const file = memory.read(space, relative);
      if (!file) throw new ToolError(`Error: The path ${absolute(relative)} does not exist`);
      const lines = file.content.split("\n");
      const line = command.insert_line;
      if (!Number.isInteger(line) || line < 0 || line > lines.length) {
        throw new ToolError(
          `Error: Invalid \`insert_line\` parameter: ${line}. It should be within the range of lines of the file: [0, ${lines.length}]`,
        );
      }
      lines.splice(line, 0, command.insert_text.replace(/\n$/, ""));
      changing(() => memory.write(space, relative, lines.join("\n"), change("insert")));
      return `The file ${absolute(relative)} has been edited.`;
    },

    delete(command) {
      const relative = path(command.path);
      if (relative === "") throw new ToolError(`Error: The ${absolute("")} directory itself can't be deleted`);
      writable(relative);
      if (!memory.read(space, relative) && !memory.isDirectory(space, relative)) {
        throw new ToolError(`Error: The path ${absolute(relative)} does not exist`);
      }
      if (mode === "one-shot" && memory.under(space, relative).some((file) => storyOnly(file.path))) {
        writable("story");
      }
      changing(() => memory.remove(space, relative, change("delete")));
      return `Successfully deleted ${absolute(relative)}`;
    },

    rename(command) {
      const from = path(command.old_path);
      const to = path(command.new_path);
      if (from === "") throw new ToolError(`Error: The ${absolute("")} directory itself can't be renamed`);
      writable(from);
      writable(to);
      if (!memory.read(space, from) && !memory.isDirectory(space, from)) {
        throw new ToolError(`Error: The path ${absolute(from)} does not exist`);
      }
      if (memory.read(space, to) || (to !== "" && memory.isDirectory(space, to))) {
        throw new ToolError(`Error: The destination ${absolute(to)} already exists`);
      }
      if (within(to, from)) throw new ToolError(`Error: ${absolute(from)} can't be moved inside itself`);
      if (mode === "one-shot" && memory.under(space, from).some((file) => storyOnly(file.path))) writable("story");
      changing(() => memory.rename(space, from, to, change("rename")));
      return `Successfully renamed ${absolute(from)} to ${absolute(to)}`;
    },
  };

  // Every command, done or refused, goes in the log.
  const log = db.prepare(
    "INSERT INTO memory_ops (run_id, space, chat_id, command, path, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const logged = {} as MemoryToolHandlers;
  for (const name of Object.keys(handlers) as (keyof MemoryToolHandlers)[]) {
    (logged as Record<string, (command: Command) => unknown>)[name] = (command: Command) => {
      const named = "path" in command ? command.path : `${command.old_path} -> ${command.new_path}`;
      try {
        const result = (handlers[name] as (command: Command) => string)(command);
        log.run(runId, space, options.chatId, name, String(named), 1, null, new Date().toISOString());
        return result;
      } catch (err) {
        const message = err instanceof ToolError ? String(err.content) : String(err);
        log.run(runId, space, options.chatId, name, String(named), 0, message, new Date().toISOString());
        throw err;
      }
    };
  }
  return logged;
}

/** The memory tool for a run of the memory model, ready for the SDK's tool runner. */
export const memoryTool = (options: ToolOptions) => betaMemoryTool(memoryCommands(options));

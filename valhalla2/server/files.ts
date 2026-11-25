// Files kept next to the database, one folder per kind: the pictures (pictures/feature.ts) and the
// audio of replies read aloud (speech/feature.ts).
//
//   <STATE_DIRECTORY>/pictures/<id>.<png|jpg|webp>
//   <STATE_DIRECTORY>/speech/<message id>-<hash>.mp3
//
// What each one is and whose it is lives in the database. A file is written to <name>.tmp and
// renamed once complete, so a half-written one is never served.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createFileStore(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  return {
    path: (file: string): string => join(dir, file),

    /** Saves bytes as `<id>.<ext>` and returns that name. */
    write(id: string, ext: string, bytes: Uint8Array): string {
      const file = `${id}.${ext}`;
      const tmp = join(dir, `${file}.tmp`);
      try {
        writeFileSync(tmp, bytes, { flag: "wx", mode: 0o600 });
        renameSync(tmp, join(dir, file));
      } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
      }
      return file;
    },

    remove(file: string): void {
      rmSync(join(dir, file), { force: true });
    },

    /**
     * Deletes every file the database (`known`) doesn't name: files whose companion was deleted,
     * and anything a crash left half-written. Returns how many went.
     */
    sweep(known: ReadonlySet<string>): number {
      let removed = 0;
      for (const name of readdirSync(dir)) {
        if (known.has(name)) continue;
        rmSync(join(dir, name), { force: true });
        removed++;
      }
      return removed;
    },
  };
}

export type FileStore = ReturnType<typeof createFileStore>;

// The pictures themselves: one file each, in a folder next to the database.
//
//   <STATE_DIRECTORY>/pictures/<id>.<png|jpg|webp>
//
// What each one is and whose it is lives in the database (store.ts). A file is written to
// <name>.tmp and renamed once complete, so a half-written one is never served.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { STATE_DIR } from "../db.ts";

/** Next to the database, as an absolute path, which sendFile needs. */
export const PICTURES_DIR = resolve(STATE_DIR, "pictures");

export function createPictureFiles(dir: string = PICTURES_DIR) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  return {
    path: (file: string): string => join(dir, file),

    /** Saves a picture's bytes as `<id>.<ext>` and returns that name. */
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
     * Deletes every file no picture in the database (`known`) names: pictures whose companion was
     * deleted, and anything a crash left half-written. Returns how many went.
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

export type PictureFiles = ReturnType<typeof createPictureFiles>;

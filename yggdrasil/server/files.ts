// The bytes of uploaded files, one file each in a folder next to the database: <id>, and
// <id>.preview for an image's smaller copy. What they are and who may see them is in the database
// (tree.ts). Uploads are written to <id>.tmp as they arrive and renamed once complete, so a file
// is never held whole in memory and a half-written one is never served.
import {
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Next to the database (see db.ts), as an absolute path, which sendFile needs. */
export const FILES_DIR = resolve(process.env.STATE_DIRECTORY ?? "data", "files");

/** A body longer than it may be. Answered with 413. */
export class TooLargeError extends Error {}

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  [...text].every((c, i) => bytes[start + i] === c.charCodeAt(0));

/** A file's type from its first bytes. The type a browser claims is never used. */
export function sniff(head: Uint8Array): string {
  if (head[0] === 0x89 && ascii(head, 1, "PNG\r\n\x1a\n")) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return "image/gif";
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return "image/webp";
  if (ascii(head, 4, "ftypavif") || ascii(head, 4, "ftypavis")) return "image/avif";
  if (ascii(head, 0, "%PDF-")) return "application/pdf";
  return "application/octet-stream";
}

export function createFiles(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const path = (id: string, preview = false) => join(dir, preview ? `${id}.preview` : id);

  /** The type of a saved file, from its first bytes. */
  function typeOf(file: string): string {
    const head = new Uint8Array(16);
    const fd = openSync(file, "r");
    try {
      readSync(fd, head, 0, head.length, 0);
    } finally {
      closeSync(fd);
    }
    return sniff(head);
  }

  return {
    path,
    typeOf,

    /**
     * Writes a request's body as file `id` (or its preview), refusing it past `limit` bytes.
     * Returns its size and type. Nothing is left behind if it fails or the upload is cut off.
     */
    async save(body: Readable, id: string, limit: number, preview = false): Promise<{ size: number; type: string }> {
      const final = path(id, preview);
      const tmp = `${final}.tmp`;
      let size = 0;
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          size += chunk.length;
          done(size > limit ? new TooLargeError(`Larger than ${limit} bytes`) : null, chunk);
        },
      });
      try {
        await pipeline(body, count, createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
        const type = typeOf(tmp);
        renameSync(tmp, final);
        return { size, type };
      } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
      }
    },

    /** Deletes a file and its preview. */
    remove(id: string): void {
      rmSync(path(id), { force: true });
      rmSync(path(id, true), { force: true });
    },

    /** Deletes only a file's preview. */
    removePreview(id: string): void {
      rmSync(path(id, true), { force: true });
    },

    /** Bytes free on the disk the files are on, for the user of this process. */
    freeBytes(): number {
      const { bavail, bsize } = statfsSync(dir);
      return bavail * bsize;
    },

    /**
     * At start-up: deletes what no file in the database (`known`) accounts for, i.e. uploads cut
     * off by a crash or restart, and files whose rows are gone. Returns how many were deleted.
     */
    sweep(known: ReadonlySet<string>): number {
      let removed = 0;
      for (const name of readdirSync(dir)) {
        const id = name.replace(/\.preview$/, "");
        if (known.has(id)) continue;
        rmSync(join(dir, name), { force: true });
        removed++;
      }
      return removed;
    },
  };
}

export type Files = ReturnType<typeof createFiles>;

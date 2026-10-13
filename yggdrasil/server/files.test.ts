import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooLargeError, createFiles, sniff, type Files } from "./files.ts";

let dir: string;
let files: Files;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yggdrasil-files-"));
  files = createFiles(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

describe("sniff", () => {
  it("knows images and PDFs by their first bytes, and nothing else", () => {
    expect(sniff(bytes([0x89], "PNG\r\n\x1a\n"))).toBe("image/png");
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniff(bytes("GIF89a"))).toBe("image/gif");
    expect(sniff(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniff(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("image/avif");
    expect(sniff(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniff(bytes("<svg xmlns="))).toBe("application/octet-stream");
    expect(sniff(bytes("<!doctype html>"))).toBe("application/octet-stream");
  });
});

describe("files", () => {
  it("saves a body as it streams in, with its size and type", async () => {
    const body = Readable.from([bytes("%PDF-1.7\n"), bytes("rest")]);
    expect(await files.save(body, ID, 100)).toEqual({ size: 13, type: "application/pdf" });
    expect(readFileSync(files.path(ID), "latin1")).toBe("%PDF-1.7\nrest");
    expect(readdirSync(dir)).toEqual([ID]);
  });

  it("refuses a body over the limit and leaves nothing behind", async () => {
    const body = Readable.from([Buffer.alloc(60), Buffer.alloc(60)]);
    await expect(files.save(body, ID, 100)).rejects.toBeInstanceOf(TooLargeError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("deletes at start-up what the database doesn't know", () => {
    const other = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    for (const name of [ID, `${ID}.preview`, other, `${other}.tmp`]) writeFileSync(join(dir, name), "x");
    expect(files.sweep(new Set([ID]))).toBe(2);
    expect(readdirSync(dir).sort()).toEqual([ID, `${ID}.preview`]);
    files.remove(ID);
    expect(readdirSync(dir)).toEqual([]);
    expect(files.freeBytes()).toBeGreaterThan(0);
  });
});

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KEY_BYTES } from "./keys.ts";

// Encryption of what is stored: each value is JSON, sealed with AES-256-GCM.
//
//   [version: 1 byte = 1][IV: 12 bytes][ciphertext][tag: 16 bytes]
//
// Every value is sealed for a context ("entries.data:<owner>:<id>") that is authenticated with it
// (GCM's additional data) but not stored: a value copied to another row, or another user's row,
// fails to open instead of showing up there.

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed value didn't open: wrong key, wrong context, or damaged. */
export class OpenError extends Error {}

export interface Sealer {
  seal(value: unknown, context: string): Uint8Array;
  open<T>(blob: Uint8Array, context: string): T;
}

export function createSealer(key: Buffer): Sealer {
  if (key.length !== KEY_BYTES) throw new Error(`The key must be ${KEY_BYTES} bytes`);
  const aad = (context: string) => Buffer.from(`janus:v${VERSION}:${context}`, "utf8");

  return {
    seal(value, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(context));
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return Buffer.concat([Buffer.of(VERSION), iv, body, cipher.getAuthTag()]);
    },

    open<T>(blob: Uint8Array, context: string): T {
      const data = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
      if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) {
        throw new OpenError(`Not a sealed value (${context})`);
      }
      const iv = data.subarray(1, 1 + IV_BYTES);
      const tag = data.subarray(data.length - TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(context));
      decipher.setAuthTag(tag);
      let text: string;
      try {
        text = Buffer.concat([
          decipher.update(data.subarray(1 + IV_BYTES, data.length - TAG_BYTES)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new OpenError(`Could not decrypt ${context}: wrong key, or the data was changed`);
      }
      return JSON.parse(text) as T;
    },
  };
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

// The key that encrypts every vault: 32 random bytes, base64, in a file of its own.
//
// On a server it is /etc/axis-suite/janus.key (root-only), which systemd hands to the service as
// a credential (LoadCredential= in janus.service): it is then readable only by this service, and
// it is kept apart from the database, so a copy of janus.db alone opens nothing.
// In development it is data/janus.key, made on first run.

export const KEY_BYTES = 32;
const CREDENTIAL = "janus-key";
const DEV_KEY_FILE = join("data", "janus.key");

/** Reads the key, or explains where it should have been. */
export function loadKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  if (env.CREDENTIALS_DIRECTORY) {
    const file = join(env.CREDENTIALS_DIRECTORY, CREDENTIAL);
    return parseKey(readFileSync(file, "utf8"), file);
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      `No encryption key: the service must be started with LoadCredential=${CREDENTIAL}:/etc/axis-suite/janus.key`,
    );
  }
  if (!existsSync(DEV_KEY_FILE)) {
    mkdirSync(dirname(DEV_KEY_FILE), { recursive: true, mode: 0o700 });
    // "wx": never overwrite a key, even if another process just made one.
    writeFileSync(DEV_KEY_FILE, randomBytes(KEY_BYTES).toString("base64") + "\n", { mode: 0o600, flag: "wx" });
    console.log(`Made a development key: ${DEV_KEY_FILE}`);
  }
  return parseKey(readFileSync(DEV_KEY_FILE, "utf8"), DEV_KEY_FILE);
}

/** The key in a key file's text. Throws unless it is exactly 32 bytes of canonical base64. */
export function parseKey(text: string, source: string): Buffer {
  const encoded = text.trim();
  const key = Buffer.from(encoded, "base64");
  // Buffer.from skips characters that aren't base64, so check that nothing was skipped.
  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) {
    throw new Error(
      `${source} must hold ${KEY_BYTES} random bytes in base64 (e.g. from: head -c 32 /dev/urandom | base64)`,
    );
  }
  return key;
}

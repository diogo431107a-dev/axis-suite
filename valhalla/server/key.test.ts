import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyError, loadApiKey } from "./key.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function credentials(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "valhalla-cred-"));
  made.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, "anthropic-api-key"), contents);
  return dir;
}

describe("the Claude API key", () => {
  it("comes from the systemd credential on a server, trimmed", () => {
    const dir = credentials("test-key-from-file\n");
    expect(loadApiKey({ CREDENTIALS_DIRECTORY: dir, NODE_ENV: "production", ANTHROPIC_API_KEY: "ignored" })).toEqual({
      apiKey: "test-key-from-file",
      from: "credential",
    });
  });

  it("is an error when the credential is missing or empty", () => {
    expect(() => loadApiKey({ CREDENTIALS_DIRECTORY: credentials() })).toThrow(KeyError);
    expect(() => loadApiKey({ CREDENTIALS_DIRECTORY: credentials("  \n") })).toThrow(KeyError);
  });

  it("is an error in production without a credential, even with the variable set", () => {
    expect(() => loadApiKey({ NODE_ENV: "production" })).toThrow(KeyError);
  });

  it("comes from ANTHROPIC_API_KEY in development, or is left to the SDK", () => {
    expect(loadApiKey({ ANTHROPIC_API_KEY: " test-key-from-env " })).toEqual({
      apiKey: "test-key-from-env",
      from: "environment",
    });
    expect(loadApiKey({})).toBeNull();
  });
});

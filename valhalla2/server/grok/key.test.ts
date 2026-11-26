import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadXaiKey } from "./key.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function credentials(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "valhalla2-xai-"));
  made.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, "xai-api-key"), contents);
  return dir;
}

describe("the xAI API key", () => {
  it("comes from the systemd credential, trimmed", () => {
    expect(loadXaiKey({ CREDENTIALS_DIRECTORY: credentials("xai-from-file\n") })).toEqual({
      apiKey: "xai-from-file",
      from: "credential",
    });
  });

  it("is optional: a missing or empty credential means no Grok", () => {
    expect(loadXaiKey({ CREDENTIALS_DIRECTORY: credentials() })).toBeNull();
    expect(loadXaiKey({ CREDENTIALS_DIRECTORY: credentials(" \n") })).toBeNull();
    expect(loadXaiKey({ NODE_ENV: "production" })).toBeNull();
  });

  it("comes from XAI_API_KEY in development", () => {
    expect(loadXaiKey({ XAI_API_KEY: " xai-from-env " })).toEqual({ apiKey: "xai-from-env", from: "environment" });
  });
});

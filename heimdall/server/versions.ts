// Heimdall's version and the suite's, for the About box. The suite's package.json isn't installed
// with Heimdall, so `pnpm build` writes both to dist/versions.json (write-versions.ts).
import { readFileSync } from "node:fs";

export interface Versions {
  module: string;
  suite: string;
  /** Running from the checkout (pnpm dev): the numbers are those of the last release. */
  dev: boolean;
}

const read = (file: string): { module?: string; suite?: string; version?: string } =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));

function load(): Versions {
  try {
    // Built: dist/server/versions.js reads dist/versions.json.
    const { module = "", suite = "" } = read("../versions.json");
    return { module, suite, dev: false };
  } catch {
    // Development: server/versions.ts, in the checkout with both package.json files.
    return {
      module: read("../package.json").version ?? "",
      suite: read("../../package.json").version ?? "",
      dev: true,
    };
  }
}

export const VERSIONS = load();

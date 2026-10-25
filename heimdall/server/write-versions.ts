// Writes Heimdall's version and the suite's to dist/versions.json, which the About box reads
// (versions.ts). `pnpm build` runs it from the checkout, after tsc.
// Usage: node server/write-versions.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const version = (file: string): string =>
  (JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as { version: string }).version;

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../dist/versions.json", import.meta.url),
  `${JSON.stringify({ module: version("../package.json"), suite: version("../../package.json") })}\n`,
);

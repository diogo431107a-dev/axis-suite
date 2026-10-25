import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // The API, against a temporary database.
      { test: { name: "server", environment: "node", include: ["server/**/*.test.ts"] } },
      // The game's rules, which have no DOM in them.
      { test: { name: "web", environment: "happy-dom", include: ["web/**/*.test.js"] } },
    ],
  },
});

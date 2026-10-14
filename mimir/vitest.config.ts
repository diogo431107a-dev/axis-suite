import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // The API, against a temporary database.
      { test: { name: "server", environment: "node", include: ["server/**/*.test.ts"] } },
      // The browser code that has no React in it (layout, keys, saving, import and export), and shared/.
      { test: { name: "web", environment: "happy-dom", include: ["web/**/*.test.ts", "shared/**/*.test.ts"] } },
    ],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // The API, against a temporary database.
      { test: { name: "server", environment: "node", include: ["server/**/*.test.ts"] } },
      // The browser code that needs no page: the sky's model and layout, and saving.
      { test: { name: "web", environment: "node", include: ["web/**/*.test.ts"] } },
    ],
  },
});

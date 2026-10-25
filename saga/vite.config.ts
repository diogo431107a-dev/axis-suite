import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// The About box shows the module's version and the suite's, as their package.json files say.
const version = (file: string): string =>
  (JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  define: {
    __AXIS_VERSIONS__: JSON.stringify({ module: version("./package.json"), suite: version("../package.json") }),
  },
  build: {
    // dist/server holds the compiled API; Caddy serves only this folder.
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5183,
    strictPort: true,
    proxy: {
      // Keep the browser's Host header: the API refuses writes whose Origin doesn't match it.
      "/api": { target: "http://127.0.0.1:3011", changeOrigin: false },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// The About box shows the module's version and the suite's, as their package.json files say.
const version = (file: string): string =>
  (JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __AXIS_VERSIONS__: JSON.stringify({ module: version("./package.json"), suite: version("../package.json") }),
  },
  build: {
    // dist/server holds the compiled API; Caddy serves only this folder.
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    // Same host as Heimdall's dev server (127.0.0.1:3000): cookies ignore the port,
    // so signing in there also signs you in here.
    host: "127.0.0.1",
    // Heimdall's dev.env lets users return to this exact address.
    port: 5174,
    strictPort: true,
    proxy: {
      // Keep the browser's Host header: the API refuses writes whose Origin doesn't match it.
      "/api": { target: "http://127.0.0.1:3002", changeOrigin: false },
    },
  },
});

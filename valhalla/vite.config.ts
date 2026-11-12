import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// The About box shows the version package.json says.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __VALHALLA_VERSION__: JSON.stringify(version),
  },
  build: {
    // dist/ holds the compiled API; the page is served from dist/web.
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5200,
    strictPort: true,
    proxy: {
      // Keep the browser's Host header: the API refuses writes whose Origin doesn't match it.
      "/api": { target: "http://127.0.0.1:3100", changeOrigin: false },
    },
  },
});

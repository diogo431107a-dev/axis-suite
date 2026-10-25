import { defineConfig } from "vite";

export default defineConfig({
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

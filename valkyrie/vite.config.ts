import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    port: 5179,
    strictPort: true,
    proxy: {
      // Keep the browser's Host header: the API refuses writes whose Origin doesn't match it.
      "/api": { target: "http://127.0.0.1:3007", changeOrigin: false },
    },
  },
});

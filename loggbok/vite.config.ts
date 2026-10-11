import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same host as Heimdall's dev server (127.0.0.1:3000): cookies ignore the port,
    // so signing in there also signs you in here.
    host: '127.0.0.1',
    proxy: {
      // Keep the browser's Host header: the API refuses writes whose Origin doesn't match it.
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
})

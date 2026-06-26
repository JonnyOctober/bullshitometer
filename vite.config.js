import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the React app runs on Vite (5173) and the API on Express (8787).
// Requests to /api are proxied to Express so the browser never sees the key.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});

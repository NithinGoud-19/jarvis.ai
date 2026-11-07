import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward /api/* to the backend, so the browser sees one origin.
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});

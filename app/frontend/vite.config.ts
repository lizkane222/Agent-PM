import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [svgr(), react(), tailwindcss()],
  resolve: {
    alias: {
      "twilio-agent-pm-shared": fileURLToPath(
        new URL("../../../twilio-agent-pm-shared/dist/index.js", import.meta.url)
      ),
    },
  },
  // .env lives at app/ (one level up from app/frontend/), not in the frontend dir
  envDir: "../",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

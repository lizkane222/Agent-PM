import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "twilio-agent-pm-shared": fileURLToPath(
        new URL("../../../twilio-agent-pm-shared/dist/index.js", import.meta.url)
      ),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/hooks/**", "src/pages/**"],
    },
  },
});

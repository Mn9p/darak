import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { DATABASE_URL: "file:./test.db", AUTH_SECRET: "test-secret" },
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});

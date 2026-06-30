import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["./tests/setup-home.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "node_modules",
        "dist",
        "tests",
        "**/*.test.ts",
        ".opencode/**",
        "**/*.config.ts",
        "**/*.config.js",
        "**/*.d.ts",
        "sonar-project.properties",
        ".gitignore",
        "src/web/**",
        "examples/**",
        "scripts/**",
        "src/types/**",
        "src/services/ai/session-types.ts",
        "src/services/handlers/shared-types.ts",
        "src/services/handlers/admin.ts",
        "src/services/handlers/profile.ts",
        "src/services/handlers/transcripts.ts",
      ],
    },
  },
});

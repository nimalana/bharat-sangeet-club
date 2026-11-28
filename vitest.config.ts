import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Component and behaviour tests (npm run test:component). The pure-logic tests that run
// under `node --test` (npm run test:unit) are not collected here.
//
// Vitest runs on Vite (a peer dependency of vitest, so `vite` stays in package.json). The screens are tested without
// any Next runtime. TSX is compiled by Vite itself, using the tsconfig (jsx: react-jsx), so no React plugin is needed.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/component/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/component/setup.ts"],
    // Every test starts from a clean fake client, cache and clock (see setup.ts).
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15_000,
  },
});

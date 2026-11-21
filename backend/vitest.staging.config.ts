import { defineConfig } from "vitest/config";

/**
 * The staging suite: real Postgres, real RPC, real constraints.
 *
 * Separate from vitest.config.ts on purpose. `npm test` must stay offline and
 * fast — that is why it gets run — and these tests are neither. They exist
 * because a mocked `rpc()` returns whatever it was told to, which is how a
 * function that could not execute at all passed twelve tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/staging/**/*.test.ts"],
    // Real round trips, and two of these deliberately race.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});

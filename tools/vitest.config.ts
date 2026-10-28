import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Many suites build or validate the whole embedded dataset (2-4s alone). Under a full parallel
    // run they exceed vitest's 5s/10s defaults, so give tests and hooks headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

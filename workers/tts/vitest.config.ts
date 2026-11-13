import { readFileSync } from "node:fs";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const repo = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Every test mints fresh random codes, so storage can be shared.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            MAX_UPLOAD_BYTES: "200000",
            // Upload fixtures (the workers pool cannot import files as text).
            FIXTURE_DAEMONS_ROS: repo("tools/test/fixtures/import/battlescribe/daemons.ros"),
            FIXTURE_GW_TEXT: repo("conformance/roster/sm-gw-app-exact-groups/input.gw.txt"),
          },
        },
      },
    },
  },
});

import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";
import { TEST_PUBLIC_KEY_B64URL } from "./test/keypair";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ENTITLEMENT_PUBLIC_KEYS: TEST_PUBLIC_KEY_B64URL,
            },
          },
        },
      },
    },
  };
});

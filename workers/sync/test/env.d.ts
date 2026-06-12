import type { Env } from "../src/index";
import type { D1Migration } from "@cloudflare/workers-types/experimental";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

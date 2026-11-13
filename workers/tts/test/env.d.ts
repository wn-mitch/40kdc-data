import type { Env } from "../src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    FIXTURE_DAEMONS_ROS: string;
    FIXTURE_GW_TEXT: string;
  }
}

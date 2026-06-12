import { applyD1Migrations, env } from "cloudflare:test";

// The pool provides a fresh D1; bring it to the current schema before tests.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

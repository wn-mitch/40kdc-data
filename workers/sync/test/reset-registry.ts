import { env } from "cloudflare:test";

// The pool pins a Durable Object instance to the constructor identity of the
// test file that first touched it; the next FILE to call the same instance
// gets one "main module changed, invalidating this Durable Object" error and
// the instance resets. The SyncRegistry singleton is shared by several suites
// (session create, the doc_live PUT guard, doc-bound capacity), so absorb that
// reset here — before any real test can trip over it.
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    await env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global")).activeCount();
    break;
  } catch {
    /* invalidation reset — retry constructs a fresh instance */
  }
}

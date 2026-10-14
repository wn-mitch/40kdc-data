import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import type { JsonValue, Questions, SystemOneResult } from "@typesafe-ai/sdk";

/**
 * A durable, content-addressed cache of Jev answers, sidecar to (not part of) the round5c
 * workbench schema: a pilot run is disposable/re-runnable infrastructure, not corpus state. Keyed
 * by a hash of everything that determines the answer (model, the state the model was given, and
 * the question asked) so a crash-and-resume, or a full re-run over the same sample, only pays for
 * what it hasn't already asked. Lives at whatever path the caller gives it — conventionally
 * alongside the arm's copy database under `_private/`.
 */

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };

export type JevCache = { db: DatabaseSync };

export function openJevCache(path: string): JevCache {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSyncCtor(path) as DatabaseSync;
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jev_answers (
      cache_key TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `);
  return { db };
}

export function closeJevCache(cache: JevCache): void {
  cache.db.close();
}

/** Canonical (sorted-key) JSON so key-order differences never cause a spurious cache miss. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The cache key covers everything that could change the answer: the model, the state given to
 * it (which carries the actual source text being judged — two pieces asking an identically-worded
 * question, e.g. "Which of these effect families...", are NOT the same request unless their
 * source text and candidate list also match), and the question/choices themselves.
 */
export function cacheKeyFor(model: string, state: Record<string, JsonValue>, questions: Questions): string {
  return createHash("sha256").update(canonicalJson({ model, state, questions })).digest("hex");
}

export function getCachedAnswer(cache: JevCache, key: string): SystemOneResult<Questions> | undefined {
  const row = cache.db.prepare("SELECT response_json FROM jev_answers WHERE cache_key = ?").get(key) as { response_json: string } | undefined;
  if (!row) return undefined;
  return JSON.parse(row.response_json) as SystemOneResult<Questions>;
}

export function putCachedAnswer(cache: JevCache, key: string, model: string, response: SystemOneResult<Questions>): void {
  cache.db.prepare("INSERT OR REPLACE INTO jev_answers (cache_key, model, response_json, created_at) VALUES (?, ?, ?, ?)")
    .run(key, model, JSON.stringify(response), new Date().toISOString());
}

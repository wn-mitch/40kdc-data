import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import { cachedEmbeddings, type Embedder } from "../src/round5c/embeddings.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string, options?: { readOnly?: boolean }): DatabaseType };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const embedder: Embedder = { model: "fixture", embed: async (texts) => texts.map((text) => new Float32Array([text.length, 1])) };

describe("Round 5C embedding cache", () => {
  it("embeds on a read-only connection without keeping the vectors, and keeps them on a writable one", async () => {
    const root = mkdtempSync(join(tmpdir(), "round5c-embed-"));
    roots.push(root);
    const path = join(root, "workbench.sqlite");
    const writable = new DatabaseSync(path);
    initializeWorkbench(writable);
    writable.close();

    const readOnly = new DatabaseSync(path, { readOnly: true });
    const first = await cachedEmbeddings(readOnly, embedder, ["abc", "de"]);
    expect(first.embedded).toBe(2);
    expect([...first.vectors[0]!]).toEqual([3, 1]);
    expect(readOnly.prepare("SELECT count(*) AS n FROM text_embeddings").get()).toEqual({ n: 0 });
    readOnly.close();

    const db = new DatabaseSync(path);
    await cachedEmbeddings(db, embedder, ["abc"]);
    expect((await cachedEmbeddings(db, embedder, ["abc"])).embedded).toBe(0);
    db.close();
  });
});

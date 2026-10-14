import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../src/mfm/repo-files.js";

// The 40kdc-abilities raw-text store is retired: rule prose comes only from the private MFM dump
// (tools/src/mfm/record-prose.ts). This scan fails when any tool, agent, skill or workflow names
// the store again, so a reader or writer cannot quietly come back.

const ROOTS = ["tools/src", "tools/test", "tools/package.json", ".omp", ".claude", "scripts", "examples", "crates", "python/src", "python/codegen", "go", ".github", "Justfile"];
const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".venv", "__pycache__", ".svelte-kit", ".wrangler", "docs"]);
// Agent and skill instructions (.md) count: they tell agents where to read prose from.
const CODE = /\.(ts|tsx|js|mjs|cjs|svelte|json|py|rs|go|sh|ya?ml|toml|md)$|^Justfile$/;
const NEEDLE = "40kdc-abilities";

/** Files that may still name the store, each with the reason. Remove an entry when its reason goes. */
const ALLOWED: Record<string, string> = {
  "tools/test/no-abilities-store.test.ts": "this guard",
  "tools/src/round4/contracts.ts": "provenance literal of datasets frozen from the retired store",
  "tools/src/round4b/contracts.ts": "provenance literal of datasets frozen from the retired store",
  "tools/test/round4.test.ts": "fixture of a dataset frozen from the retired store",
  "examples/codex/src/App.svelte": "example app fetches the public repo at runtime; moves with the examples phase",
  "examples/data-explorer/src/lib/source-store.ts": "example app fetches the public repo at runtime; moves with the examples phase",
  "examples/data-explorer/src/lib/source-store.test.ts": "example app fetches the public repo at runtime; moves with the examples phase",
};

function* files(path: string): Generator<string> {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(path).sort()) if (!SKIP_DIRS.has(name)) yield* files(join(path, name));
  } else if (CODE.test(path.split("/").pop()!)) {
    yield path;
  }
}

describe("the retired 40kdc-abilities store", () => {
  it("is named by no tool, agent, skill or workflow outside the allowlist", () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(join(REPO_ROOT, root))) {
        const rel = relative(REPO_ROOT, file);
        if (!(rel in ALLOWED) && readFileSync(file, "utf8").includes(NEEDLE)) hits.push(rel);
      }
    }
    expect(hits, "read rule prose through tools/src/mfm/record-prose.ts (npm run prose), not the retired store").toEqual([]);
  });

  it("keeps the allowlist honest: every allowed file still exists and still names the store", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      try {
        return !readFileSync(join(REPO_ROOT, rel), "utf8").includes(NEEDLE);
      } catch {
        return true;
      }
    });
    expect(stale).toEqual([]);
  });
});

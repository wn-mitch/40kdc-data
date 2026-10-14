import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import { leafExamples } from "../src/round5c/leaf-examples.js";
import { refreshSources } from "../src/round5c/source.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
// Fabricated wording only.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(records: Array<{ faction_id: string; ability_id: string; raw_text: string }>): DatabaseType {
  const root = mkdtempSync(join(tmpdir(), "round5c-examples-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

describe("Round 5C wording examples", () => {
  it("shows each wording in its own sentence, one per ability, spread across factions", () => {
    const db = fixture([
      { faction_id: "alpha", ability_id: "one", raw_text: "Warden tactics. Each time this unit hops, gain 1CP. Then rest." },
      { faction_id: "alpha", ability_id: "two", raw_text: "Each time this unit hops, gain 1CP." },
      { faction_id: "alpha", ability_id: "three", raw_text: "Each time this unit hops, gain 1CP." },
      { faction_id: "beta", ability_id: "four", raw_text: "Once per battle: each time this unit hops, gain 1CP." },
    ]);
    const result = leafExamples(db, { text: "gain 1CP", limit: 2 });
    expect(result.total).toBe(4);
    // Two factions before a second alpha ability.
    expect(result.examples.map((item) => item.faction_id)).toEqual(["alpha", "beta"]);
    expect(result.examples[0]).toMatchObject({ ability_id: "one", before: "Each time this unit hops, ", match: "gain 1CP", after: "." });
    expect(result.examples[1]).toMatchObject({ before: "each time this unit hops, ", match: "gain 1CP" });
    expect(leafExamples(db, { text: "gain 1CP", faction: "beta" }).examples.map((item) => item.ability_id)).toEqual(["four"]);
    expect(() => leafExamples(db, { text: "  " })).toThrow(/wording/u);
  });
});

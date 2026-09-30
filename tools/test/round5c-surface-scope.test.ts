import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { humanActor } from "../src/round5c/authority.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { confirmSurface, reapplyLeafSurfaces } from "../src/round5c/leaves.js";
import { refreshSources } from "../src/round5c/source.js";
import { inScope, parseScope } from "../src/round5c/surface-scope.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const WILL = humanActor("will", "test");
// Fabricated fixture prose only.
const D6 = { family_id: "dice-roll", family_version: 4, parameters: { dice: "D6" } };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(texts: string[]): DatabaseType {
  const root = mkdtempSync(join(tmpdir(), "round5c-scope-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(texts.map((raw_text, index) => ({ faction_id: "alpha", ability_id: `a${index}`, raw_text }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

function d6Rows(db: DatabaseType): string[] {
  return (db.prepare(`
    SELECT abilities.ability_id FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND fingerprints.family_id = 'dice-roll' ORDER BY abilities.ability_id
  `).all() as Array<{ ability_id: string }>).map((row) => row.ability_id);
}

describe("Round 5C surface scope", () => {
  it("reads a clause's opening words and the next whole word, not a longer word or an earlier clause", () => {
    const scope = parseScope({ clause_prefix: ["", "End of the"], not_followed_by: ["for"] })!;
    const at = (before: string, after: string) => inScope(scope, { fragment: "WHEN", source_type: "stratagem", before, after });
    expect(at("", ".")).toBe(true);
    expect(at("Your turn. end of the ", ".")).toBe(true);
    expect(at("Your opponent's ", ".")).toBe(false);
    expect(at("", " for each model")).toBe(false);
    expect(at("", " fortress")).toBe(true);
    const after = parseScope({ preceded_by: ["select one enemy unit"] })!;
    expect(inScope(after, { fragment: "EFFECT", source_type: "stratagem", before: "Then **select one enemy unit** ", after: "" })).toBe(true);
    expect(inScope(after, { fragment: "EFFECT", source_type: "stratagem", before: "Then reselect one enemy unit ", after: "" })).toBe(false);
    expect(inScope(after, { fragment: "EFFECT", source_type: "stratagem", before: "Select one enemy unit. Each friendly unit ", after: "" })).toBe(false);
    expect(() => parseScope({ nearby: ["x"] })).toThrow(/no field nearby/u);
  });

  it("applies a scoped surface only in scope, and an unscoped re-apply of it still honours the stored scope", () => {
    const db = fixture(["Roll one D6: on a 4+, gain 1CP.", "Roll one D6 for each model in this unit.", "Then roll one D6: on a 5+, gain 1CP."]);
    try {
      const report = confirmSurface(db, { reviewer: "will", exact_text: "Roll one D6", ...D6, scope: { not_followed_by: ["for", "each time"] } }, WILL);
      expect(report).toMatchObject({ applied: 2, out_of_scope: 1 });
      expect(d6Rows(db)).toEqual(["a0", "a2"]);
      expect(reapplyLeafSurfaces(db)).toMatchObject({ applied: 0, out_of_scope: 1 });
      expect(d6Rows(db)).toEqual(["a0", "a2"]);
      expect(JSON.parse((db.prepare("SELECT scope_json FROM leaf_surfaces WHERE id = ?").get(report.surface_id) as { scope_json: string }).scope_json))
        .toEqual({ version: 1, not_followed_by: ["each time", "for"] });
      // The same wording under another scope is another decision, refused while this one stands.
      expect(() => confirmSurface(db, { reviewer: "will", exact_text: "Roll one D6", ...D6 }, WILL)).toThrow(/already decided within/u);
    } finally {
      db.close();
    }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { humanActor } from "../src/semantic-authoring/authority.js";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";
import { confirmSurface, reapplyLeafSurfaces } from "../src/semantic-authoring/leaves.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { getAbilityCoverage } from "../src/semantic-authoring/coverage.js";
import { applyChatReview } from "../src/semantic-authoring/review-apply.js";
import { undoBatch } from "../src/semantic-authoring/review.js";
import { currentFamilyVersion } from "../src/semantic-authoring/contracts.js";
import { inScope, parseScope } from "../src/semantic-authoring/surface-scope.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const WILL = humanActor("will", "test");
// Fabricated fixture prose only.
const D6 = { family_id: "dice-roll", family_version: currentFamilyVersion("dice-roll"), parameters: { dice: "D6" } };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(texts: string[]): DatabaseType {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-scope-"));
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

describe("Semantic authoring surface scope", () => {
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
    expect(inScope(after, { fragment: "EFFECT", source_type: "stratagem", before: "Then select one enemy unit (", after: ")" })).toBe(true);
    expect(inScope(after, { fragment: "EFFECT", source_type: "stratagem", before: "Select one enemy unit. Each friendly unit ", after: "" })).toBe(false);
    const bracketed = parseScope({ bracketed: true })!;
    expect(inScope(bracketed, { fragment: "EFFECT", source_type: "stratagem", before: "attacks have the **[", after: "]** ability." })).toBe(true);
    expect(inScope(bracketed, { fragment: "EFFECT", source_type: "stratagem", before: "Select the ", after: " doctrine." })).toBe(false);
    expect(inScope(bracketed, { fragment: "EFFECT", source_type: "stratagem", before: "attacks have [", after: " doctrine]" })).toBe(false);
    expect(() => parseScope({ bracketed: false })).toThrow(/only be true/u);
    const leads = parseScope({ followed_by: ["friendly", "enemy"] })!;
    expect(inScope(leads, { fragment: "RAW_TEXT", source_type: "unit", before: "you can select one", after: " **friendly** Orks unit" })).toBe(true);
    expect(inScope(leads, { fragment: "RAW_TEXT", source_type: "unit", before: "you can select one", after: " of the following" })).toBe(false);
    expect(inScope(leads, { fragment: "RAW_TEXT", source_type: "unit", before: "you can select one", after: " friendlyish unit" })).toBe(false);
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

  it("lets a review retire a scoped surface and decide the same wording everywhere", async () => {
    const db = fixture(["Roll one D6: on a 4+, gain 1CP.", "Roll one D6 for each model in this unit."]);
    try {
      confirmSurface(db, { reviewer: "will", exact_text: "Roll one D6", ...D6, scope: { not_followed_by: ["for"] } }, WILL);
      expect(d6Rows(db)).toEqual(["a0"]);
      const result = await applyChatReview(db, { reviewer: "will", decisions: [
        { action: "retire-surface", exact_text: "Roll one D6" },
        { action: "surface", exact_text: "Roll one D6", ...D6 },
      ] });
      expect(result.failed).toEqual([]);
      expect(d6Rows(db)).toEqual(["a0", "a1"]);
      expect((await applyChatReview(db, { reviewer: "will", decisions: [{ action: "retire-surface", exact_text: "Gain 1CP" }] })).failed[0]!.error).toMatch(/No active surface/u);
    } finally {
      db.close();
    }
  });

  it("accounts for a joining wording between leaves, never inside one, and undoes it with its batch", async () => {
    const db = fixture(["Roll one D6 and roll one D6.", "Roll one D6 and stand fast.", "Stand fast and hold, then roll one D6."]);
    try {
      confirmSurface(db, { reviewer: "will", exact_text: "Roll one D6", ...D6 }, WILL);
      const id = (abilityId: string) => (db.prepare("SELECT id FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId) as { id: number }).id;
      const unaccounted = (abilityId: string) => getAbilityCoverage(db, id(abilityId)).unaccounted.map((run) => run.text);
      expect(unaccounted("a0")).toEqual(["and"]);
      const result = await applyChatReview(db, { reviewer: "will", decisions: [{ action: "connective-surface", exact_text: "and", relation: "coexists-with" } as never] });
      expect(result.failed).toEqual([]);
      expect(unaccounted("a0")).toEqual([]);
      // A joiner touching no leaf ("stand fast and hold") is left for when its neighbours are decided.
      expect((result.applied[0] as unknown as { connective: { applied: number; no_neighbour: number } }).connective).toMatchObject({ applied: 2, no_neighbour: 1 });
      // "and stand fast" is still unaccounted past the joiner; the joiner itself is not.
      expect(unaccounted("a1").join(" ")).not.toMatch(/^and\b/u);
      expect((await applyChatReview(db, { reviewer: "will", decisions: [{ action: "connective-surface", exact_text: "and", relation: "not-a-relation" } as never] })).failed[0]!.error)
        .toMatch(/not a known relation/u);
    } finally {
      db.close();
    }
  });

  it("takes one designer's note out of the denominator, refusing an overlap and undoing cleanly", async () => {
    // Fabricated fixture prose only.
    const db = fixture(["Roll one D6. Designer's Note: this only clarifies timing."]);
    try {
      confirmSurface(db, { reviewer: "will", exact_text: "Roll one D6", ...D6 }, WILL);
      const id = (db.prepare("SELECT id FROM abilities WHERE current = 1").get() as { id: number }).id;
      const before = getAbilityCoverage(db, id).leaf_bytes;
      const note = "Designer's Note: this only clarifies timing";
      const result = await applyChatReview(db, { reviewer: "will", decisions: [{ action: "add-connective", ability_version_id: id, exact_text: note } as never] });
      expect(result.failed).toEqual([]);
      const after = getAbilityCoverage(db, id);
      expect(after.unaccounted).toEqual([]);
      expect(after.leaf_bytes.denominator).toBeLessThan(before.denominator);
      expect(after.leaf_bytes.numerator).toBe(before.numerator);
      // A span that overlaps a trusted leaf is not a connective.
      expect((await applyChatReview(db, { reviewer: "will", decisions: [{ action: "add-connective", ability_version_id: id, exact_text: "one D6. Designer" } as never] })).failed[0]!.error)
        .toMatch(/overlaps a trusted leaf/u);
      undoBatch(db, result.applied[0]!.batch_id, { reviewer: "will" }, WILL);
      expect(getAbilityCoverage(db, id).leaf_bytes).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("picks one occurrence of a repeated joiner by its start byte, and refuses a byte where it is not", async () => {
    // Fabricated fixture prose only.
    const text = "Roll one D6 and roll one D6 again.";
    const db = fixture([text]);
    try {
      const id = (db.prepare("SELECT id FROM abilities WHERE current = 1").get() as { id: number }).id;
      const and = (at: number) => applyChatReview(db, { reviewer: "will", decisions: [{ action: "add-connective", ability_version_id: id, exact_text: " and ", start_byte: at } as never] });
      // " and " occurs once here, but "one D6" repeats: the byte form also works where text search would.
      expect((await and(text.indexOf(" and "))).failed).toEqual([]);
      expect((await applyChatReview(db, { reviewer: "will", decisions: [{ action: "add-connective", ability_version_id: id, exact_text: "one D6" } as never] })).failed[0]!.error)
        .toMatch(/exactly once/u);
      const second = text.lastIndexOf("one D6");
      expect((await applyChatReview(db, { reviewer: "will", decisions: [{ action: "add-connective", ability_version_id: id, exact_text: "one D6", start_byte: second } as never] })).failed).toEqual([]);
      expect((await applyChatReview(db, { reviewer: "will", decisions: [{ action: "add-connective", ability_version_id: id, exact_text: "one D6", start_byte: second + 1 } as never] })).failed[0]!.error)
        .toMatch(/is not at byte/u);
    } finally {
      db.close();
    }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { initializeWorkbench, insertSpan } from "../src/semantic-authoring/db.js";
import { getAbility } from "../src/semantic-authoring/review.js";
import { surfaceWarnings } from "../src/semantic-authoring/surface-lint.js";
import { leafBoard, retractQualifiedSurfaceLeaves } from "../src/semantic-authoring/leaves.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { confirmSurface } from "./semantic-authoring-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

// Fabricated fixture prose only.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(records: Array<{ ability_id: string; raw_text: string }>): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-targeting-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records.map((record) => ({ faction_id: "alpha", ...record }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

function current(db: DatabaseSync, abilityId: string): { id: number; source_text: string } {
  return db.prepare("SELECT id, source_text FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId) as { id: number; source_text: string };
}

describe("Semantic authoring targeting families", () => {
  it("rebuilds an older family table so combinators fit, keeping fingerprints and their references", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE semantic_families (
          id TEXT NOT NULL, version INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION')),
          parameter_schema_json TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(id, version)
        ) STRICT;
        CREATE TABLE fingerprints (
          id TEXT PRIMARY KEY CHECK(id = 'fp_' || canonical_hash), family_id TEXT NOT NULL, family_version INTEGER NOT NULL,
          parameters_json TEXT NOT NULL, canonical_hash TEXT NOT NULL UNIQUE, legacy_fingerprint_id TEXT UNIQUE, status TEXT NOT NULL,
          FOREIGN KEY(family_id, family_version) REFERENCES semantic_families(id, version) ON UPDATE RESTRICT ON DELETE RESTRICT
        ) STRICT;
      `);
      const hash = "a".repeat(64);
      // A family the registry no longer lists, so seeding leaves it alone.
      db.prepare("INSERT INTO semantic_families VALUES ('retired-family', 1, 'EFFECT', '{}', 'deprecated')").run();
      db.prepare("INSERT INTO fingerprints VALUES (?, 'retired-family', 1, '{}', ?, NULL, 'active')").run(`fp_${hash}`, hash);
      initializeWorkbench(db);
      expect(db.prepare("SELECT role FROM semantic_families WHERE id = 'instead'").get()).toEqual({ role: "COMBINATOR" });
      expect(db.prepare("SELECT family_id FROM fingerprints WHERE id = ?").get(`fp_${hash}`)).toEqual({ family_id: "retired-family" });
      // The rebuilt table still anchors the foreign key.
      expect(() => db.prepare("INSERT INTO fingerprints VALUES (?, 'nowhere', 1, '{}', ?, NULL, 'active')").run(`fp_${"b".repeat(64)}`, "b".repeat(64))).toThrow(/FOREIGN KEY/u);
    } finally {
      db.close();
    }
  });

  it("canonicalises predicate parameters and refuses meanings the subject cannot have", () => {
    expect(normalizeFingerprintParameters("unit-keyword", { keywords: ["**vehicle**", "MONSTER"], subject: "target", negated: false }))
      .toEqual({ keywords: ["MONSTER", "VEHICLE"], subject: "target", negated: false });
    expect(() => normalizeFingerprintParameters("unit-keyword", { keywords: ["Vehicle", "VEHICLE"], subject: "target", negated: false })).toThrow(/twice/u);
    expect(normalizeFingerprintParameters("unit-state", { states: ["below-half-strength", "battle-shocked"], subject: "target", negated: true }).states)
      .toEqual(["below-half-strength", "battle-shocked"]);
    expect(normalizeFingerprintParameters("unit-state", { states: ["battle-shocked", "below-half-strength"], subject: "target", negated: true }).states)
      .toEqual(["below-half-strength", "battle-shocked"]);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "closest-eligible", subject: "event-object", negated: false })).toThrow(/not closest-eligible/u);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", of: "this-unit", subject: "target", negated: false })).toThrow(/takes inches/u);
    expect(normalizeFingerprintParameters("unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false }).controlled_by).toBe("any");
    expect(() => normalizeFingerprintParameters("select-unit", { scope: "enemy", distance: "any", inches: 12, visible: true })).toThrow(/exactly/u);
    expect(() => normalizeFingerprintParameters("attack", { direction: "makes", unit: "this-model" })).toThrow(/attack_type is required/u);
    expect(() => normalizeFingerprintParameters("event", { kind: "attack-made" })).toThrow(/event.kind/u);
    // Melee or ranged narrows weapons, so it cannot apply to a model characteristic or to an attack.
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { subject: "this-unit", characteristics: ["OC", "A"], operation: "add", value: 1, weapon_type: "melee" })).toThrow(/only weapon characteristics/u);
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "melee" })).toThrow(/attack's own leaf/u);
    expect(normalizeFingerprintParameters("characteristic-modifier", { subject: "this-unit", characteristics: ["S", "A"], operation: "add", value: 1, weapon_type: "melee" }).characteristics).toEqual(["A", "S"]);
  });

  it("says a model, its unit or the target is on the battlefield, and nothing else of a model", () => {
    const onField = (subject: string, negated = false) => {
      const result = compileLeaves([
        { role: "CONDITION", family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: normalizeFingerprintParameters("unit-state", { states: ["on-battlefield"], subject, negated }), start_byte: 0 },
        { role: "EFFECT", family_id: "fights-first", family_version: currentFamilyVersion("fights-first"), parameters: { subject: "this-unit" }, start_byte: 10 },
      ]);
      if (!result.ok) throw new Error(result.errors.join("; "));
      return (result.mechanics.effect as { condition: unknown }).condition;
    };
    expect(onField("this-model")).toEqual({ type: "matches", parameters: { subject: "this-model", filter: { state: "on-battlefield" } } });
    expect(onField("this-unit", true)).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "on-battlefield" } } }] });
    expect(onField("target")).toEqual({ type: "matches", parameters: { subject: "defender", filter: { state: "on-battlefield" } } });
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["on-battlefield", "engaged"], subject: "this-model", negated: false })).toThrow(/only being on the battlefield/u);
  });

  it("warns when a decided spelling says more than its meaning", () => {
    const plus = { roll: "hit", operation: "add", value: 1 };
    expect(surfaceWarnings("this unit's ranged blows gain a bonus", "EFFECT", "roll-modifier", plus)).toEqual([expect.stringMatching(/Says ranged/u)]);
    expect(surfaceWarnings("blows that target the foe gain a bonus", "EFFECT", "roll-modifier", plus)).toEqual([expect.stringMatching(/targets/u)]);
    expect(surfaceWarnings("gain a bonus if the foe is thinned", "EFFECT", "roll-modifier", plus)).toEqual([expect.stringMatching(/condition/u)]);
    expect(surfaceWarnings("gain a bigger bonus instead", "EFFECT", "roll-modifier", plus)).toEqual([expect.stringMatching(/instead/u)]);
    expect(surfaceWarnings("this model regains 1 lost wound", "EFFECT", "characteristic-modifier", { subject: "this-model", characteristic: "W", operation: "add", value: 1 }))
      .toEqual([expect.stringMatching(/regaining lost wounds/u)]);
    expect(surfaceWarnings("this model regains 1 lost wound", "EFFECT", "regain-wounds", { subject: "this-model", amount: "1" })).toEqual([]);
    // The meaning already carries the qualifier.
    expect(surfaceWarnings("each time this model makes a ranged attack", "EVENT", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" })).toEqual([]);
    expect(surfaceWarnings("melee weapons gain a bonus ability", "EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "melee" })).toEqual([]);
    expect(surfaceWarnings("each time this model makes a ranged attack", "EVENT", "attack", { direction: "makes", unit: "this-model", attack_type: "melee" })).toHaveLength(1);
  });

  it("does not apply a spelling where a word before it narrows the meaning, and retracts old ones that did", () => {
    const exact = "weapons equipped by models in that unit gain the [LETHAL HITS] edge";
    const db = fixture([
      { ability_id: "all", raw_text: `While leading, ${exact}.` },
      { ability_id: "melee", raw_text: `While leading, melee ${exact}.` },
      { ability_id: "kind", raw_text: `While leading, **BEASTS** ${exact}.` },
    ]);
    try {
      const meaning = { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all" };
      confirmSurface(db, { reviewer: "r", exact_text: "While leading", family_id: "leading-unit", parameters: { subject: "this-model", attachment: "leading" } });
      const report = confirmSurface(db, { reviewer: "r", exact_text: exact, family_id: "weapon-ability-grant", parameters: meaning });
      expect(report.applied).toBe(1);
      expect(report.blocked.map((item) => [item.ability_id, item.reason]).sort()).toEqual([["kind", "QUALIFIED_HERE"], ["melee", "QUALIFIED_HERE"]]);
      // The whole qualified wording is left for its own decision instead of a stray "melee".
      expect(leafBoard(db).untiled.map((item) => item.sample_text)).toContain(`melee ${exact}`);

      // A leaf applied before the guard existed is retracted once, and only that one.
      const row = current(db, "melee");
      const start = Buffer.byteLength(row.source_text.slice(0, row.source_text.indexOf(exact)));
      const spanId = insertSpan(db, row.id, "RAW_TEXT", start, start + Buffer.byteLength(exact), exact);
      const surface = db.prepare("SELECT fingerprint_id, batch_id FROM leaf_surfaces WHERE status = 'active' AND normalized_surface LIKE 'weapons%'").get() as { fingerprint_id: string; batch_id: string };
      db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, created_at) VALUES (?, ?, 'active', 'leaf-surface', 'human', 'r', ?, 'x')").run(spanId, surface.fingerprint_id, surface.batch_id);
      expect(retractQualifiedSurfaceLeaves(db)).toEqual({ retracted: 1 });
      expect(retractQualifiedSurfaceLeaves(db)).toEqual({ retracted: 0 });
      expect(getAbility(db, current(db, "all").id).annotations).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

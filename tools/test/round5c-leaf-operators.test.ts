import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { humanActor } from "../src/round5c/authority.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { currentFamilyVersion, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { confirmOperator, operatorDefinition, operatorSpellings } from "../src/round5c/leaf-operators.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { confirmSurface } from "../src/round5c/leaves.js";
import { refreshSources } from "../src/round5c/source.js";
import { undoBatch } from "../src/round5c/review.js";

/** act-after-move's current version, which a confirmed operator must name. */
const MOVE_VERSION = currentFamilyVersion("act-after-move");
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const WILL = humanActor("will", "test");

// Fabricated fixture prose only.
const MOVE_PERMISSION = {
  reviewer: "will",
  family_id: "act-after-move",
  family_version: MOVE_VERSION,
  template: "{subject} is eligible to {acts} in a turn in which it {moves}",
  slots: {
    subject: { parameter: "subject", spellings: { "this unit": "this-unit", "this model": "this-model", "the bearer’s unit": "this-unit" } },
    acts: { parameter: "acts", spellings: { "declare a charge": ["charge"], shoot: ["shoot"] } },
    moves: { parameter: "moves", spellings: { advanced: ["advance"], "advanced or fell back": ["advance", "fall-back"] } },
  },
  scope: { not_followed_by: ["or"] },
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(texts: string[]): DatabaseType {
  const root = mkdtempSync(join(tmpdir(), "round5c-operator-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(texts.map((raw_text, index) => ({ faction_id: "alpha", ability_id: `a${index}`, raw_text }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

type Row = { ability_id: string; exact_text: string; authority_kind: string; parameters: Record<string, unknown>; operator_id: number | null };

function moveRows(db: DatabaseType): Row[] {
  return (db.prepare(`
    SELECT abilities.ability_id, source_spans.exact_text, annotations.authority_kind, fingerprints.parameters_json, leaf_surfaces.operator_id
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    LEFT JOIN leaf_surfaces ON leaf_surfaces.id = annotations.derived_from_surface_id
    WHERE annotations.status = 'active' AND fingerprints.family_id = 'act-after-move' ORDER BY abilities.ability_id
  `).all() as Array<Omit<Row, "parameters"> & { parameters_json: string }>)
    .map(({ parameters_json, ...row }) => ({ ...row, parameters: JSON.parse(parameters_json) as Record<string, unknown> }));
}

describe("Round 5C leaf operators", () => {
  it("binds each occurrence's own subject, act and move spelling to one decided operator", () => {
    const db = fixture([
      "This unit is eligible to declare a charge in a turn in which it Advanced.",
      "This model is eligible to declare a charge in a turn in which it Advanced.",
      "The bearer’s unit is eligible to shoot in a turn in which it Advanced or Fell Back.",
    ]);
    const report = confirmOperator(db, MOVE_PERMISSION, WILL);
    expect(report.applied).toBe(3);
    const rows = moveRows(db);
    expect(rows.map((row) => [row.ability_id, row.parameters])).toEqual([
      ["a0", { subject: "this-unit", moves: ["advance"], acts: ["charge"] }],
      ["a1", { subject: "this-model", moves: ["advance"], acts: ["charge"] }],
      // The longer move spelling claims the occurrence; "advanced" alone stays out of scope before "or".
      ["a2", { subject: "this-unit", moves: ["advance", "fall-back"], acts: ["shoot"] }],
    ]);
    // Copies are derived, never human, and trace to the operator through their surface.
    expect(rows.every((row) => row.authority_kind === "derived" && row.operator_id === report.operator_id)).toBe(true);
    expect(report.spellings).toHaveLength(12);
  });

  it("refuses the whole operator when one spelling already means something else, writing nothing", () => {
    const db = fixture(["This model is eligible to declare a charge in a turn in which it Advanced."]);
    confirmSurface(db, {
      reviewer: "will", exact_text: "This model is eligible to declare a charge in a turn in which it Advanced",
      family_id: "act-after-move", family_version: MOVE_VERSION, parameters: { subject: "this-unit", moves: ["advance"], acts: ["charge"] },
    }, WILL);
    const before = moveRows(db);
    expect(() => confirmOperator(db, MOVE_PERMISSION, WILL)).toThrow(/already decided with another meaning/iu);
    expect(moveRows(db)).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM leaf_operators").get()).toEqual({ n: 0 });
  });

  it("keeps an earlier surface of the same meaning as decided, without relinking it", () => {
    const db = fixture(["This unit is eligible to declare a charge in a turn in which it Advanced.", "This model is eligible to shoot in a turn in which it Advanced."]);
    const earlier = confirmSurface(db, {
      reviewer: "will", exact_text: "This unit is eligible to declare a charge in a turn in which it Advanced",
      family_id: "act-after-move", family_version: MOVE_VERSION, parameters: { subject: "this-unit", moves: ["advance"], acts: ["charge"] },
    }, WILL);
    const report = confirmOperator(db, MOVE_PERMISSION, WILL);
    expect(report.spellings.find((item) => item.surface_id === earlier.surface_id)?.surface_status).toBe("kept");
    expect(moveRows(db).map((row) => [row.ability_id, row.operator_id])).toEqual([["a0", null], ["a1", report.operator_id]]);
  });

  it("undoes the operator, its spellings and every leaf they derived", () => {
    const db = fixture(["This model is eligible to declare a charge in a turn in which it Advanced."]);
    const report = confirmOperator(db, MOVE_PERMISSION, WILL);
    expect(moveRows(db)).toHaveLength(1);
    undoBatch(db, report.batch_id, { reviewer: "will" }, WILL);
    expect(moveRows(db)).toEqual([]);
    expect(db.prepare("SELECT status FROM leaf_operators WHERE id = ?").get(report.operator_id)).toEqual({ status: "retired" });
    expect(db.prepare("SELECT count(*) AS n FROM leaf_surfaces WHERE operator_id = ? AND status = 'active'").get(report.operator_id)).toEqual({ n: 0 });
  });

  it("undoes an operator whose leaf a family-version migration later replaced", () => {
    const db = fixture(["This model is eligible to declare a charge in a turn in which it Advanced."]);
    const report = confirmOperator(db, MOVE_PERMISSION, WILL);
    const leaf = db.prepare("SELECT id, span_id, fingerprint_id, origin, authority_kind, confirmed_by, derived_from_surface_id FROM annotations WHERE status = 'active'").get() as
      { id: number; span_id: number; fingerprint_id: string; origin: string; authority_kind: string; confirmed_by: string; derived_from_surface_id: number };
    // What `migrateFamilyVersions` writes: the leaf superseded by an identical successor in a system batch.
    db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('migration_test', 'migration-family-versions', 'system', 'now')").run();
    db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ?").run(leaf.id);
    const successor = Number(db.prepare(`
      INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, derived_from_surface_id, created_at)
      VALUES (?, ?, 'active', ?, ?, ?, 'migration_test', ?, ?, 'now')
    `).run(leaf.span_id, leaf.fingerprint_id, leaf.origin, leaf.authority_kind, leaf.confirmed_by, leaf.id, leaf.derived_from_surface_id).lastInsertRowid);
    undoBatch(db, report.batch_id, { reviewer: "will" }, WILL);
    expect(db.prepare("SELECT status FROM annotations WHERE id = ?").get(successor)).toEqual({ status: "retracted" });
    // The batch's own row stays superseded; nothing it replaced comes back.
    expect(db.prepare("SELECT status FROM annotations WHERE id = ?").get(leaf.id)).toEqual({ status: "superseded" });
    expect(moveRows(db)).toEqual([]);
  });

  it("undoes an operator around a leaf a later, longer surface superseded, leaving that surface's leaf", () => {
    const db = fixture(["This model is eligible to declare a charge in a turn in which it Advanced, even if it was Battle-shocked."]);
    const report = confirmOperator(db, MOVE_PERMISSION, WILL);
    const longer = "This model is eligible to declare a charge in a turn in which it Advanced, even if it was Battle-shocked";
    confirmSurface(db, { reviewer: "will", exact_text: longer, family_id: "act-after-move", family_version: MOVE_VERSION, parameters: { subject: "this-unit", moves: ["advance"], acts: ["charge"] } }, WILL);
    const before = moveRows(db);
    expect(before).toEqual([expect.objectContaining({ exact_text: longer, operator_id: null })]);
    undoBatch(db, report.batch_id, { reviewer: "will" }, WILL);
    expect(moveRows(db)).toEqual(before);
    expect(db.prepare("SELECT status FROM leaf_operators WHERE id = ?").get(report.operator_id)).toEqual({ status: "retired" });
  });

  it("rejects malformed templates and spellings that collapse to one surface", () => {
    expect(() => operatorDefinition({ ...MOVE_PERMISSION, template: "this unit is eligible to charge" })).toThrow(/at least one \{slot\}/u);
    expect(() => operatorDefinition({ ...MOVE_PERMISSION, template: "{subject} is eligible to {acts}" })).toThrow(/unused moves/u);
    expect(() => operatorDefinition({ ...MOVE_PERMISSION, fixed: { subject: "this-unit" } })).toThrow(/supplied twice/u);
    const alternatives = operatorSpellings(operatorDefinition({
      family_id: "act-after-move", family_version: MOVE_VERSION, template: "**{a}** or **{b}** unit",
      slots: { a: { parameter: "keywords", spellings: { infantry: "INFANTRY", mounted: "MOUNTED" } }, b: { parameter: "keywords", spellings: { mounted: "MOUNTED" } } },
    }));
    expect(alternatives.map((item) => item.parameters.keywords)).toEqual([["INFANTRY", "MOUNTED"], ["MOUNTED", "MOUNTED"]]);
    const listed = operatorSpellings(operatorDefinition({
      family_id: "act-after-move", family_version: MOVE_VERSION, template: "**{a}** or **{b}** unit",
      slots: { a: { parameter: "keywords", spellings: { infantry: "INFANTRY", mounted: "MOUNTED" } }, b: { parameter: "keywords", spellings: { infantry: "INFANTRY", mounted: "MOUNTED" } } },
      combinations: [{ a: "infantry", b: "mounted" }],
    }));
    expect(listed.map((item) => [item.wording, item.parameters.keywords])).toEqual([["**infantry** or **mounted** unit", ["INFANTRY", "MOUNTED"]]]);
    expect(() => operatorDefinition({
      family_id: "act-after-move", family_version: MOVE_VERSION, template: "**{a}** or **{b}** unit",
      slots: { a: { parameter: "keywords", spellings: { infantry: "INFANTRY" } }, b: { parameter: "keywords", spellings: { mounted: "MOUNTED" } } },
      combinations: [{ a: "infantry", b: "vehicle" }],
    })).toThrow(/declared spellings/u);
    const collapsing = operatorDefinition({
      ...MOVE_PERMISSION,
      slots: { ...MOVE_PERMISSION.slots, subject: { parameter: "subject", spellings: { "This unit": "this-unit", "this unit": "this-model" } } },
    });
    expect(() => operatorSpellings(collapsing)).toThrow(/same surface/u);
  });

  it("refuses a spelling whose value the family does not allow", () => {
    const db = fixture(["This model is eligible to declare a charge in a turn in which it Advanced."]);
    const bad = { ...MOVE_PERMISSION, slots: { ...MOVE_PERMISSION.slots, subject: { parameter: "subject", spellings: { "this model": "selected-unit" } } } };
    expect(() => confirmOperator(db, bad, WILL)).toThrow(/this model is eligible/u);
    expect(moveRows(db)).toEqual([]);
  });

  it("prefills the unit, not the model, for a model's or bearer's unit with either apostrophe", () => {
    const family = REVIEWED_FAMILY_REGISTRY.find((item) => item.id === "act-after-move" && item.version === currentFamilyVersion("act-after-move")) as unknown as PrefillFamily;
    const subject = (text: string) => prefillFromSource(family, text).subject;
    expect(subject("this model’s unit is eligible to declare a charge in a turn in which it Advanced")).toBe("this-unit");
    expect(subject("this model's unit is eligible to declare a charge in a turn in which it Advanced")).toBe("this-unit");
    expect(subject("the bearer’s unit is eligible to shoot in a turn in which it Fell Back")).toBe("this-unit");
    expect(subject("this model is eligible to shoot in a turn in which it Fell Back")).toBe("this-model");
    expect(subject("the bearer is eligible to shoot in a turn in which it Fell Back")).toBe("this-model");
  });
});

describe("Round 5C core keyword index", () => {
  it("knows detachment-granted keywords and reads either apostrophe as one keyword", async () => {
    const { keywordIndex, splitKeywords } = await import("../src/round5c/core-keywords.js");
    const root = mkdtempSync(join(tmpdir(), "round5c-keywords-"));
    roots.push(root);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture keywords only.
    writeFileSync(join(root, "core", "alpha", "units.json"), JSON.stringify([{ keywords: ["Infantry", "Squadron"], faction_keywords: ["T’Alpha Host"] }]));
    writeFileSync(join(root, "core", "alpha", "detachments.json"), JSON.stringify([{ granted_keywords: [{ keyword: "Armoured Vanguard", to_keywords: ["Squadron"] }] }]));
    mkdirSync(join(root, "enrichment", "alpha"), { recursive: true });
    writeFileSync(join(root, "enrichment", "alpha", "abilities.json"), JSON.stringify([{ effect: {
      type: "sequence", steps: [{ type: "keyword-grant", target: { all_of: ["Not A Grant"] }, modifier: { keywords: ["Celestial Foundry"] } }],
    } }]));
    const index = keywordIndex(root);
    expect(splitKeywords("ARMOURED VANGUARD", index)).toEqual(["Armoured Vanguard"]);
    expect(splitKeywords("T'ALPHA HOST INFANTRY", index)).toEqual(["T’Alpha Host", "Infantry"]);
    expect(splitKeywords("T’ALPHA HOST", index)).toEqual(["T’Alpha Host"]);
    expect(splitKeywords("CELESTIAL FOUNDRY INFANTRY", index)).toEqual(["Celestial Foundry", "Infantry"]);
    expect(() => splitKeywords("NOT A GRANT", index)).toThrow(/not a unit keyword/u);
    expect(() => splitKeywords("ARMOURED SKIRMISHER", index)).toThrow(/not a unit keyword/u);
  });
});

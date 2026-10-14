import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";

import { preparePublication, publishPublication } from "../src/round5c/publish.js";
import { publishableEntries } from "../src/round5c/publish-queue.js";

import { getShape, listShapes } from "../src/round5c/shapes.js";
import { refreshSources } from "../src/round5c/source.js";
import { approveShape, confirmSurface, moveSurface, rejectShapeMembers, undoBatch } from "./round5c-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
// Fabricated fixture prose only.
const LEAD = "While this model is leading a unit";
const REROLL = "you can re-roll a Hit roll of 1";
const SHAPE = "CONDITION(leading-unit) · EFFECT(reroll)";

const roots: string[] = [];
const originalDataRoot = process.env.ROUND5C_DATA_ROOT;
const originalStore = process.env.ROUND5C_SOURCE_FIXTURE;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalDataRoot === undefined) delete process.env.ROUND5C_DATA_ROOT; else process.env.ROUND5C_DATA_ROOT = originalDataRoot;
  if (originalStore === undefined) delete process.env.ROUND5C_SOURCE_FIXTURE; else process.env.ROUND5C_SOURCE_FIXTURE = originalStore;
});

const records = [
  { faction_id: "fixture", ability_id: "alpha", raw_text: `${LEAD}, ${REROLL}.` },
  { faction_id: "fixture", ability_id: "copy", raw_text: `${LEAD}, ${REROLL}.` },
  { faction_id: "fixture", ability_id: "other", raw_text: `${LEAD}; ${REROLL}.` },
  { faction_id: "fixture", ability_id: "partial", raw_text: `${LEAD}, ${REROLL} and roll a die.` },
];

/** A tracked entry the compiler can graft onto, authored with a different (wrong) meaning. */
function authoredEntry(abilityId: string): Record<string, unknown> {
  return {
    ability_id: abilityId, name: abilityId, authored_by: "fixture", game_version: { edition: "10th", dataslate: "fixture" },
    effect: { type: "re-roll", target: "this-unit", modifier: { roll: "wound", subset: "ones" } },
    scope: { duration: "permanent" }, behavior: "passive",
  };
}

let db: DatabaseSync;
let abilitiesFile: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "round5c-shapes-"));
  roots.push(root);
  const store = join(root, "store");
  mkdirSync(store);
  writeFileSync(join(store, "fixture.json"), JSON.stringify(records));
  const dataRoot = join(root, "data");
  mkdirSync(join(dataRoot, "enrichment", "fixture"), { recursive: true });
  abilitiesFile = join(dataRoot, "enrichment", "fixture", "abilities.json");
  writeFileSync(abilitiesFile, `${JSON.stringify(records.map((record) => authoredEntry(record.ability_id)), null, 2)}\n`);
  process.env.ROUND5C_DATA_ROOT = dataRoot;
  process.env.ROUND5C_SOURCE_FIXTURE = store;
  db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, store);
  confirmSurface(db, { reviewer: REVIEWER, exact_text: LEAD, family_id: "leading-unit", parameters: { subject: "this-model", attachment: "leading" } });
});
afterEach(() => db.close());

const reroll = (subset: string) => confirmSurface(db, { reviewer: REVIEWER, exact_text: REROLL, family_id: "reroll", parameters: { roll: "hit", subset, weapon_type: "all" } });
const ids = () => getShape(db, SHAPE).members.flatMap((member) => member.ability_version_ids);

describe("Round 5C shapes", () => {
  it("groups only fully described sources, folds identical text, and puts changed entries first", () => {
    reroll("ones");
    const listed = listShapes(db);
    expect(listed.shapes).toEqual([expect.objectContaining({ signature: SHAPE, members: 3, distinct_sources: 2, compiles: 3, approved: 0, open: 3 })]);
    const shape = getShape(db, SHAPE);
    expect(shape.members.map((member) => member.abilities.map((ability) => ability.ability_id).sort())).toEqual([["alpha", "copy"], ["other"]]);
    expect(shape.members[0]).toMatchObject({ differs: true, state: "open", errors: [] });
    expect(shape.members[0]!.compiled_text).toMatch(/attached|leading/iu);
    expect(shape.members[0]!.authored_text).not.toBe(shape.members[0]!.compiled_text);
  });

  it("approves members at once, marks them stale when a leaf changes, and undoes approval", () => {
    const decision = reroll("ones");
    const approval = approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() });
    expect(approval.recorded).toBe(3);
    expect(listShapes(db).shapes[0]).toMatchObject({ approved: 3, open: 0 });
    expect(approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() }).recorded).toBe(0);

    moveSurface(db, { reviewer: REVIEWER, surface_id: decision.surface_id, family_id: "reroll", parameters: { roll: "hit", subset: "all", weapon_type: "all" } });
    expect(getShape(db, SHAPE).members.every((member) => member.state === "stale")).toBe(true);
    const second = approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() });
    expect(db.prepare("SELECT status, count(*) AS total FROM compiled_entries GROUP BY status ORDER BY status").all())
      .toEqual([{ status: "approved", total: 3 }, { status: "retracted", total: 3 }]);
    undoBatch(db, second.batch_id, { reviewer: REVIEWER });
    expect(db.prepare("SELECT count(*) AS total FROM compiled_entries WHERE status = 'approved'").get()).toEqual({ total: 3 });
    expect(getShape(db, SHAPE).members.every((member) => member.state === "stale")).toBe(true);
  });

  it("keeps a rejected member out until its leaves change, and refuses members that left the shape", () => {
    reroll("ones");
    const other = getShape(db, SHAPE).members.find((member) => member.abilities[0]!.ability_id === "other")!;
    rejectShapeMembers(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: other.ability_version_ids });
    expect(getShape(db, SHAPE).members.find((member) => member.abilities[0]!.ability_id === "other")!.state).toBe("rejected");
    expect(listShapes(db).shapes[0]).toMatchObject({ open: 2 });
    const partial = db.prepare("SELECT id FROM abilities WHERE ability_id = 'partial'").get() as { id: number };
    expect(() => approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: [partial.id] })).toThrow(/no longer current and fully described/u);
    expect(() => approveShape(db, { reviewer: REVIEWER, signature: "EFFECT(reroll)", ability_version_ids: other.ability_version_ids })).toThrow(/no longer has this shape/u);
  });

  it("publishes an approved shape member through the guarded publisher", async () => {
    reroll("failed");
    approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() });
    const entryIds = (db.prepare(`
      SELECT compiled_entries.id FROM compiled_entries JOIN abilities ON abilities.id = compiled_entries.ability_version_id
      WHERE compiled_entries.status = 'approved' ORDER BY abilities.ability_id
    `).all() as Array<{ id: string }>).map((row) => row.id);
    expect(publishableEntries(db)).toMatchObject({ factions: [{ faction_id: "fixture", entries: [
      { ability_id: "alpha", changes: ["effect"] }, { ability_id: "copy", changes: ["effect"] }, { ability_id: "other", changes: ["effect"] },
    ] }], stale: 0, unchanged: 0 });
    const preview = await preparePublication(db, { faction_id: "fixture", entry_ids: entryIds });
    expect(preview.ability_ids).toEqual(["alpha", "copy", "other"]);
    await publishPublication(db, { batch_id: preview.batch_id, preview_hash: preview.preview_hash });
    const published = JSON.parse(readFileSync(abilitiesFile, "utf8")) as Array<Record<string, unknown>>;
    expect(published.find((entry) => entry.ability_id === "copy")).toMatchObject({
      effect: { type: "conditional", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } }, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "all-failures" } } },
      scope: { duration: "permanent" },
      behavior: "passive",
    });
    expect(published.find((entry) => entry.ability_id === "partial")!.effect).toEqual(authoredEntry("partial").effect);
    expect(publishableEntries(db)).toEqual({ factions: [], stale: 0, unchanged: 3 });
  }, 120_000);
});

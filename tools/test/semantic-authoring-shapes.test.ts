import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";

import { preparePublication, publishPublication } from "../src/semantic-authoring/publish.js";
import { publishableEntries } from "../src/semantic-authoring/publish-queue.js";

import { applyChatReview } from "../src/semantic-authoring/review-apply.js";
import { factionReviewSheet, writeReviewSheet } from "../src/semantic-authoring/review-sheet.js";
import { getShape, listShapes, reviewMembers } from "../src/semantic-authoring/shapes.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { approveShape, confirmSurface, moveSurface, rejectShapeMembers, undoBatch } from "./semantic-authoring-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
// Fabricated fixture prose only.
const LEAD = "While this model is leading a unit";
const REROLL = "you can re-roll a Hit roll of 1";
const SHAPE = "CONDITION(leading-unit) · EFFECT(reroll)";

const roots: string[] = [];
const originalDataRoot = process.env.SEMANTIC_AUTHORING_DATA_ROOT;
const originalStore = process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalDataRoot === undefined) delete process.env.SEMANTIC_AUTHORING_DATA_ROOT; else process.env.SEMANTIC_AUTHORING_DATA_ROOT = originalDataRoot;
  if (originalStore === undefined) delete process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE; else process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = originalStore;
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
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-shapes-"));
  roots.push(root);
  const store = join(root, "store");
  mkdirSync(store);
  writeFileSync(join(store, "fixture.json"), JSON.stringify(records));
  const dataRoot = join(root, "data");
  mkdirSync(join(dataRoot, "enrichment", "fixture"), { recursive: true });
  abilitiesFile = join(dataRoot, "enrichment", "fixture", "abilities.json");
  writeFileSync(abilitiesFile, `${JSON.stringify(records.map((record) => authoredEntry(record.ability_id)), null, 2)}\n`);
  process.env.SEMANTIC_AUTHORING_DATA_ROOT = dataRoot;
  process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = store;
  db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, store);
  confirmSurface(db, { reviewer: REVIEWER, exact_text: LEAD, family_id: "leading-unit", parameters: { subject: "this-model", attachment: "leading" } });
});
afterEach(() => db.close());

const reroll = (subset: string) => confirmSurface(db, { reviewer: REVIEWER, exact_text: REROLL, family_id: "reroll", parameters: { roll: "hit", subset, weapon_type: "all" } });
const ids = () => getShape(db, SHAPE).members.flatMap((member) => member.ability_version_ids);

describe("Semantic authoring shapes", () => {
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

  it("approves members at once, marks them stale when a leaf changes, and undoes approval", async () => {
    const decision = reroll("ones");
    const approval = await approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() });
    expect(approval.recorded).toBe(3);
    expect(listShapes(db).shapes[0]).toMatchObject({ approved: 3, open: 0 });
    expect((await approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() })).recorded).toBe(0);

    moveSurface(db, { reviewer: REVIEWER, surface_id: decision.surface_id, family_id: "reroll", parameters: { roll: "hit", subset: "all", weapon_type: "all" } });
    expect(getShape(db, SHAPE).members.every((member) => member.state === "stale")).toBe(true);
    const second = await approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() });
    expect(db.prepare("SELECT status, count(*) AS total FROM compiled_entries GROUP BY status ORDER BY status").all())
      .toEqual([{ status: "approved", total: 3 }, { status: "retracted", total: 3 }]);
    undoBatch(db, second.batch_id, { reviewer: REVIEWER });
    expect(db.prepare("SELECT count(*) AS total FROM compiled_entries WHERE status = 'approved'").get()).toEqual({ total: 3 });
    expect(getShape(db, SHAPE).members.every((member) => member.state === "stale")).toBe(true);
  });

  it("keeps a rejected member out until its leaves change, and refuses members that left the shape", async () => {
    reroll("ones");
    const other = getShape(db, SHAPE).members.find((member) => member.abilities[0]!.ability_id === "other")!;
    rejectShapeMembers(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: other.ability_version_ids });
    expect(getShape(db, SHAPE).members.find((member) => member.abilities[0]!.ability_id === "other")!.state).toBe("rejected");
    expect(listShapes(db).shapes[0]).toMatchObject({ open: 2 });
    const partial = db.prepare("SELECT id FROM abilities WHERE ability_id = 'partial'").get() as { id: number };
    await expect(approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: [partial.id] })).rejects.toThrow(/no longer current and fully described/u);
    await expect(approveShape(db, { reviewer: REVIEWER, signature: "EFFECT(reroll)", ability_version_ids: other.ability_version_ids })).rejects.toThrow(/no longer has this shape/u);
  });

  it("publishes an approved shape member through the guarded publisher", async () => {
    reroll("failed");
    await approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: ids() });
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

  it("applies approve-shape and reject-shape from a signed decisions file, and refuses an unsigned draft", async () => {
    reroll("ones");
    const other = getShape(db, SHAPE).members.find((member) => member.abilities[0]!.ability_id === "other")!.ability_version_ids;
    const rest = ids().filter((id) => !other.includes(id));
    await expect(applyChatReview(db, { reviewer: "<reviewer>", decisions: [{ action: "approve-shape", signature: SHAPE, ability_version_ids: rest }] })).rejects.toThrow(/unsigned draft/u);
    expect(db.prepare("SELECT count(*) AS n FROM compiled_entries").get()).toEqual({ n: 0 });

    const result = await applyChatReview(db, { reviewer: REVIEWER, decisions: [
      { action: "approve-shape", signature: SHAPE, ability_version_ids: rest },
      { action: "reject-shape", signature: SHAPE, ability_version_ids: other },
      { action: "approve-shape", signature: "EFFECT(reroll)", ability_version_ids: other },
    ] });
    expect(result.applied).toHaveLength(2);
    expect(result.failed).toEqual([expect.objectContaining({ error: expect.stringMatching(/no longer has this shape/u) })]);
    expect(db.prepare("SELECT status, count(*) AS n FROM compiled_entries GROUP BY status ORDER BY status").all()).toEqual([{ status: "approved", n: 2 }, { status: "rejected", n: 1 }]);
    expect((db.prepare("SELECT DISTINCT reviewer FROM annotation_batches WHERE metadata_json LIKE '%shape-%'").all() as Array<{ reviewer: string }>).map((row) => row.reviewer)).toEqual([REVIEWER]);
  });

  it("lists each fully described source once with its shape and state", async () => {
    reroll("ones");
    const before = reviewMembers(db);
    expect(before.map((row) => row.ability_id).sort()).toEqual(["alpha", "copy", "other"]);
    expect(before.every((row) => row.signature === SHAPE && row.state === "open" && row.differs)).toBe(true);
    await approveShape(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: before.filter((row) => row.ability_id === "alpha").map((row) => row.ability_version_id) });
    expect(reviewMembers(db).find((row) => row.ability_id === "alpha")!.state).toBe("approved");
  });

  it("drafts approvals only for passing, undecided members of a faction", async () => {
    reroll("ones");
    const other = getShape(db, SHAPE).members.find((member) => member.abilities[0]!.ability_id === "other")!.ability_version_ids;
    rejectShapeMembers(db, { reviewer: REVIEWER, signature: SHAPE, ability_version_ids: other });
    const sheet = await factionReviewSheet(db, "fixture");
    expect(sheet.totals.tiled).toBe(3);
    const drafted = sheet.proposed_decisions.decisions.flatMap((decision) => decision.ability_version_ids ?? []);
    expect(drafted.length).toBeGreaterThan(0);
    expect(drafted.some((id) => other.includes(id))).toBe(false);
    const passing = [...sheet.changed, ...sheet.unchanged].map((row) => row.ability_version_id).filter((id) => !other.includes(id));
    expect(drafted.sort()).toEqual(passing.sort());
    expect(sheet.proposed_decisions.reviewer).toBe("<reviewer>");
  }, 120_000);

  it("refuses to write a review sheet into tracked repository paths", () => {
    const sheet = { faction_id: "fixture", totals: { tiled: 0, all_gates: 0, changed: 0, unchanged: 0, approved: 0, failing: 0 }, changed: [], unchanged: [], approved: [], failing: [], proposed_decisions: { reviewer: "<reviewer>", decisions: [] } };
    expect(() => writeReviewSheet(sheet, join(process.cwd(), "src"))).toThrow(/_private/u);
    const outside = mkdtempSync(join(tmpdir(), "review-sheet-"));
    roots.push(outside);
    expect(writeReviewSheet(sheet, outside).decisions).toBe(join(outside, "fixture.decisions.json"));
  });
});

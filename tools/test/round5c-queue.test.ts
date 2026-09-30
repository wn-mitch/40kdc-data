import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentFamilyVersion, validateFingerprint } from "../src/round5c/contracts.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { prepareLuna } from "../src/round5c/proposal.js";
import { getQueue, type QueueItem } from "../src/round5c/queue.js";
import { proposeLexical, retrieveFamilyCandidates } from "../src/round5c/retrieval.js";
import { getAbility, getDashboard } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";
import { applyAnnotationBatch, undoBatch } from "./round5c-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

const temporaryRoots: string[] = [];
let previousArtifactDirectory: string | undefined;
beforeEach(() => {
  previousArtifactDirectory = process.env.ROUND5C_ARTIFACT_DIR;
  const directory = mkdtempSync(join(tmpdir(), "round5c-queue-artifacts-"));
  temporaryRoots.push(directory);
  process.env.ROUND5C_ARTIFACT_DIR = directory;
});
afterEach(() => {
  if (previousArtifactDirectory === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
  else process.env.ROUND5C_ARTIFACT_DIR = previousArtifactDirectory;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type RecordFixture = { id: string; faction_id: string; raw_text: string };
type Ability = { id: number; source_text: string };

function fixture(records: RecordFixture[]): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "round5c-queue-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

function ability(db: DatabaseSync, abilityId: string): Ability {
  const row = db.prepare("SELECT id, source_text FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId) as Ability | undefined;
  if (!row) throw new Error(`Fixture ability ${abilityId} is absent.`);
  return row;
}

function span(source: string, exactText: string): { start: number; end: number } {
  const start = source.indexOf(exactText);
  if (start < 0) throw new Error(`Fixture span ${exactText} is absent.`);
  return { start: Buffer.byteLength(source.slice(0, start), "utf8"), end: Buffer.byteLength(source.slice(0, start + exactText.length), "utf8") };
}

function seed(db: DatabaseSync, abilityId: string, exactText: string, familyId: string, parameters: Record<string, unknown>): number {
  const target = ability(db, abilityId);
  const bytes = span(target.source_text, exactText);
  const spanId = insertSpan(db, target.id, "RAW_TEXT", bytes.start, bytes.end, exactText);
  const fingerprintId = validateFingerprint(db, familyId, parameters, currentFamilyVersion(familyId), exactText);
  const batchId = `seed-${abilityId}-${bytes.start}`;
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES (?, 'fixture', 'reviewer', '2026-01-01T00:00:00.000Z')").run(batchId);
  const inserted = db.prepare(`
    INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
    VALUES (?, ?, 'active', 'fixture', 'human', 'reviewer', ?, NULL, '2026-01-01T00:00:00.000Z')
  `).run(spanId, fingerprintId, batchId);
  return Number(inserted.lastInsertRowid);
}

function pendingProposal(db: DatabaseSync, abilityId: string, exactText: string, origin: string, fingerprint: { family: string; parameters: Record<string, unknown>; role: string } | null): number {
  const target = ability(db, abilityId);
  const bytes = span(target.source_text, exactText);
  const spanId = insertSpan(db, target.id, "RAW_TEXT", bytes.start, bytes.end, exactText);
  const fingerprintId = fingerprint ? validateFingerprint(db, fingerprint.family, fingerprint.parameters, currentFamilyVersion(fingerprint.family), exactText) : null;
  const inserted = db.prepare(`
    INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
    VALUES (?, ?, ?, ?, ?, '{"kind":"fixture"}', NULL, '2026-01-01T00:00:00.000Z')
  `).run(spanId, fingerprintId, fingerprint?.role ?? "UNRESOLVED", origin, fingerprint ? "pending" : "unresolved");
  return Number(inserted.lastInsertRowid);
}

const HIT_ONES = "Re-roll a Hit roll of 1";
const WOUND_FAILED = "Re-roll a failed Wound roll";

/** A big hit-roll group in the alphabetically last faction and a small wound group in the first. */
function yieldFixture(): DatabaseSync {
  const records: RecordFixture[] = [
    { id: "zz-seed", faction_id: "zeta", raw_text: `${HIT_ONES}.` },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `zz-hit-${String(index).padStart(2, "0")}`, faction_id: "zeta", raw_text: `${HIT_ONES}.` })),
    { id: "aa-seed", faction_id: "alpha", raw_text: `${WOUND_FAILED}.` },
    ...Array.from({ length: 3 }, (_, index) => ({ id: `aa-wound-${index}`, faction_id: "alpha", raw_text: `${WOUND_FAILED}.` })),
    { id: "zz-residue", faction_id: "zeta", raw_text: "A distinct uncovered mechanic remains." },
  ];
  const db = fixture(records);
  seed(db, "zz-seed", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
  seed(db, "aa-seed", WOUND_FAILED, "reroll", { roll: "wound", subset: "failed", weapon_type: "all" });
  proposeLexical(db);
  return db;
}

function familyItems(items: readonly QueueItem[]): QueueItem[] {
  return items.filter((item) => item.kind === "family-group");
}

function confirmPage(db: DatabaseSync, signature: string): void {
  const page = retrieveFamilyCandidates(db, "reroll", { signature });
  const occurrences = page.groups.flatMap((group) => group.occurrences);
  applyAnnotationBatch(db, {
    reviewer: "fixture-reviewer",
    decisions: occurrences.map((item) => ({
      action: "confirm",
      proposal_id: item.proposal_id,
      ability_version_id: item.ability_version_id,
      source_hash: item.source_hash,
      fragment: item.fragment,
      start_byte: item.start_byte,
      end_byte: item.end_byte,
      exact_text: item.exact_text,
      role: item.role,
      family_id: item.family_id,
      family_version: item.family_version,
      parameters: item.parameters,
    })),
  });
}

describe("Round 5C greedy work queue", () => {
  it("ranks by yield, not faction or alphabetical order, and re-ranks after a confirmed group", () => {
    const db = yieldFixture();
    try {
      const groups = familyItems(getQueue(db).items);
      expect(groups.map((item) => [item.unlocks, item.backlog])).toEqual([[30, 30], [3, 3]]);
      expect(groups[0]!.why).toContain(HIT_ONES);
      const big = groups[0]!.target;
      if (big.view !== "family") throw new Error("family-group items must route to Family Mode");

      // Scoping to one group returns the whole group in one page; unscoped pages stay bounded.
      const page = retrieveFamilyCandidates(db, "reroll", { signature: big.signature });
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]!.occurrences).toHaveLength(30);
      expect(page.next_cursor).toBeNull();
      expect(retrieveFamilyCandidates(db, "reroll").groups.flatMap((group) => group.occurrences)).toHaveLength(20);

      confirmPage(db, big.signature);
      expect(familyItems(getQueue(db).items).map((item) => item.unlocks)).toEqual([3]);

      // The faction filter narrows every leg, including the family groups.
      const alpha = getQueue(db, { factionId: "alpha" }).items;
      expect(familyItems(alpha).map((item) => item.unlocks)).toEqual([3]);
      expect(getQueue(db, { factionId: "zeta" }).items.filter((item) => item.kind === "family-group")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("bounds a high-backlog family group without hiding later occurrences", () => {
    const db = fixture([
      { id: "seed", faction_id: "zeta", raw_text: `${HIT_ONES}.` },
      ...Array.from({ length: 32 }, (_, index) => ({ id: `hit-${index}`, faction_id: "zeta", raw_text: `Context ${index}: ${HIT_ONES}.` })),
    ]);
    try {
      seed(db, "seed", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
      proposeLexical(db);
      const group = familyItems(getQueue(db).items)[0]!;
      expect(group).toMatchObject({ unlocks: 1, backlog: 32 });
      if (group.target.view !== "family") throw new Error("Expected a family target.");
      const first = retrieveFamilyCandidates(db, "reroll", { signature: group.target.signature });
      expect(first.groups[0]!.occurrences).toHaveLength(30);
      expect(first.next_cursor).not.toBeNull();
      const second = retrieveFamilyCandidates(db, "reroll", { signature: group.target.signature, cursor: first.next_cursor! });
      expect(second.groups[0]!.occurrences).toHaveLength(2);
      const ids = [...first.groups[0]!.occurrences, ...second.groups[0]!.occurrences].map((item) => item.proposal_id);
      expect(new Set(ids).size).toBe(32);
    } finally {
      db.close();
    }
  });

  it("keeps a faction-scoped queue target inside that faction's Family page", () => {
    const db = fixture([
      { id: "seed", faction_id: "alpha", raw_text: `${HIT_ONES}.` },
      { id: "one", faction_id: "alpha", raw_text: `${HIT_ONES}.` },
      { id: "two", faction_id: "alpha", raw_text: `${HIT_ONES}.` },
      { id: "other", faction_id: "zeta", raw_text: `${HIT_ONES}.` },
    ]);
    try {
      seed(db, "seed", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
      proposeLexical(db);
      const item = familyItems(getQueue(db, { factionId: "alpha" }).items)[0]!;
      expect(item).toMatchObject({ unlocks: 2, backlog: 2 });
      if (item.target.view !== "family") throw new Error("Expected a family target.");
      const page = retrieveFamilyCandidates(db, "reroll", { signature: item.target.signature, factionId: "alpha" });
      expect(page.groups[0]!.occurrences.map((entry) => entry.faction_id)).toEqual(["alpha", "alpha"]);
      expect(page.progress.total).toBe(2);
    } finally {
      db.close();
    }
  });
  it("keeps immediately reviewable family groups ahead of the external Luna handoff", () => {
    const db = yieldFixture();
    try {
      const items = getQueue(db, { limit: 200 }).items;
      const lunaIndex = items.findIndex((item) => item.kind === "luna");
      expect(lunaIndex).toBeGreaterThan(0);
      expect(items.slice(0, lunaIndex).every((item) => item.unlocks >= 2 || item.kind === "broad-seed" || item.kind === "family-group" || item.kind === "unparsed-source")).toBe(true);
      // Untouched sources sit directly before the aggregate Luna handoff, after every repeatable decision.
      const unparsed = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "unparsed-source");
      expect(unparsed.every(({ index }) => index < lunaIndex && items.slice(index, lunaIndex).every((item) => item.kind === "unparsed-source"))).toBe(true);
      expect(items.slice(lunaIndex + 1).every((item) => item.unlocks < 2)).toBe(true);
    } finally {
      db.close();
    }

    const single = fixture([
      { id: "seed", faction_id: "zeta", raw_text: `${HIT_ONES}.` },
      { id: "other", faction_id: "zeta", raw_text: `Then ${HIT_ONES}.` },
    ]);
    try {
      seed(single, "seed", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
      proposeLexical(single);
      const items = getQueue(single).items;
      // The fully painted seed asks for nothing; its repeat is the first decision.
      expect(items[0]).toMatchObject({ kind: "family-group" });
      expect(items[1]).toMatchObject({ kind: "luna", target: { view: "luna", mode: "residue" } });
      expect(items.slice(2).map((item) => item.kind)).toEqual(["ability"]);
    } finally {
      single.close();
    }
  });

  it("pins one aggregate conflict item above every yield", () => {
    const db = yieldFixture();
    try {
      // A Luna proposal of the same role on already-confirmed seed bytes contradicts that leaf.
      pendingProposal(db, "zz-seed", HIT_ONES, "luna", { family: "reroll", parameters: { roll: "hit", subset: "all", weapon_type: "all" }, role: "EFFECT" });
      // The same fingerprint on the same bytes restates the seed and must not count.
      pendingProposal(db, "zz-seed", HIT_ONES, "hit-train", { family: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" }, role: "EFFECT" });
      const [first, ...rest] = getQueue(db).items;
      expect(first).toMatchObject({ kind: "conflict", unlocks: 1, target: { view: "abilities", ability_version_id: ability(db, "zz-seed").id } });
      expect(rest.some((item) => item.kind === "conflict")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("flags a whole-clause seed that matches nowhere else but contains a common phrase", () => {
    const clause = "that unit's ranged attacks have +1 to Hit rolls";
    const db = fixture([
      { id: "broad", faction_id: "orks", raw_text: `Until the end of the phase, ${clause}.` },
      { id: "a", faction_id: "orks", raw_text: "Those attacks have +1 to Hit rolls." },
      { id: "b", faction_id: "tau", raw_text: "Its melee weapons have +1 to Hit rolls this turn." },
      { id: "c", faction_id: "tau", raw_text: "While leading, models have +1 to Hit rolls." },
      { id: "narrow-seed", faction_id: "tau", raw_text: `${HIT_ONES}.` },
      { id: "narrow-match", faction_id: "tau", raw_text: `Then ${HIT_ONES}.` },
    ]);
    try {
      const broadId = seed(db, "broad", clause, "roll-modifier", { roll: "hit", operation: "add", value: 1 });
      const narrowId = seed(db, "narrow-seed", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
      proposeLexical(db);
      const hints = getQueue(db).items.filter((item) => item.kind === "broad-seed");
      expect(hints.map((item) => item.key)).toEqual([`broad-seed:${broadId}`]);
      expect(hints[0]!.unlocks).toBe(3);
      expect(hints[0]!.why).toMatch(/have 1 to hit rolls/);
      expect(hints.some((item) => item.key === `broad-seed:${narrowId}`)).toBe(false);
      expect(getQueue(db, { factionId: "tau" }).items.some((item) => item.kind === "broad-seed")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("clusters repeated unresolved wording but not a lone connective", () => {
    const db = fixture([
      { id: "one", faction_id: "zeta", raw_text: "Advance and gain one Command point." },
      { id: "two", faction_id: "zeta", raw_text: "Fall back and gain one Command point." },
    ]);
    try {
      for (const id of ["one", "two"]) {
        pendingProposal(db, id, "and", "luna", null);
        pendingProposal(db, id, "gain one Command point", "luna", null);
      }
      const clusters = getQueue(db).items.filter((item) => item.kind === "unresolved-cluster");
      expect(clusters.map((item) => [item.unlocks, item.why.includes("gain one Command point")])).toEqual([[2, true]]);
    } finally {
      db.close();
    }
  });

  it("treats a proposal restating a confirmed leaf as resolved until that leaf is undone", () => {
    const db = fixture([{ id: "imported", faction_id: "zeta", raw_text: `${HIT_ONES}.` }]);
    try {
      const target = ability(db, "imported");
      const hitOnes = { family: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" }, role: "EFFECT" };
      pendingProposal(db, "imported", HIT_ONES, "hit-train", hitOnes);
      expect(getAbility(db, target.id).progress.pending_proposals).toBe(1);
      const bytes = span(target.source_text, HIT_ONES);
      const confirmed = applyAnnotationBatch(db, { reviewer: "fixture-reviewer", decisions: [{
        action: "confirm", ability_version_id: target.id, source_hash: getAbility(db, target.id).source_hash,
        fragment: "RAW_TEXT", start_byte: bytes.start, end_byte: bytes.end, exact_text: HIT_ONES, role: "EFFECT",
        family_id: "reroll", family_version: 2, parameters: hitOnes.parameters,
      }] });
      const view = getAbility(db, target.id);
      expect(view.proposals).toEqual([]);
      expect(view.progress).toMatchObject({ pending_proposals: 0, composition_ready: true });
      expect(retrieveFamilyCandidates(db, "reroll").groups).toEqual([]);
      expect(getQueue(db).items.some((item) => item.kind === "family-group" || item.kind === "ability" || item.kind === "conflict")).toBe(false);
      // A different reading of the same bytes is still a question for a human.
      pendingProposal(db, "imported", HIT_ONES, "luna", { ...hitOnes, parameters: { roll: "hit", subset: "all", weapon_type: "all" } });
      expect(getQueue(db).items[0]).toMatchObject({ kind: "conflict", unlocks: 1 });

      undoBatch(db, confirmed.batch_id, { reviewer: "fixture-reviewer" });
      expect(getAbility(db, target.id).progress.pending_proposals).toBe(2);
      expect(retrieveFamilyCandidates(db, "reroll").groups.flatMap((group) => group.occurrences.map((item) => item.origin)).sort()).toEqual(["hit-train", "luna"]);
    } finally {
      db.close();
    }
  });

  it("shows pending proposals from every origin in Family Mode", () => {
    const db = fixture([{ id: "imported", faction_id: "zeta", raw_text: `${HIT_ONES}.` }]);
    try {
      pendingProposal(db, "imported", HIT_ONES, "hit-train", { family: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" }, role: "EFFECT" });
      const page = retrieveFamilyCandidates(db, "reroll");
      expect(page.groups.flatMap((group) => group.occurrences.map((item) => item.origin))).toEqual(["hit-train"]);
      expect(page.progress).toEqual({ reviewed: 0, total: 1 });
      expect(familyItems(getQueue(db).items)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe("Round 5C residue", () => {
  const source = "Deploy the unit anywhere. Re-roll a Hit roll of 1. Then gain one Command point.";

  it("excludes bytes any pending or unresolved proposal already claims", () => {
    const db = fixture([{ id: "mixed", faction_id: "zeta", raw_text: source }]);
    try {
      const target = ability(db, "mixed");
      const before = getAbilityCoverage(db, target.id);
      expect(before.residue).toEqual(before.uncovered);
      pendingProposal(db, "mixed", HIT_ONES, "luna", { family: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" }, role: "EFFECT" });
      pendingProposal(db, "mixed", "gain one Command point", "luna", null);
      const after = getAbilityCoverage(db, target.id);
      expect(after.uncovered).toEqual(before.uncovered);
      const residueText = after.residue.map((region) => region.text);
      expect(residueText.join(" | ")).not.toMatch(/Re-roll|Command/);
      expect(residueText.some((text) => text.includes("Deploy the unit anywhere"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("sends Luna only residue regions, largest residue first, within one faction", () => {
    const db = fixture([
      { id: "small", faction_id: "zeta", raw_text: "Advance." },
      { id: "large", faction_id: "zeta", raw_text: source },
      { id: "elsewhere", faction_id: "alpha", raw_text: `${source} And more words here.` },
    ]);
    try {
      pendingProposal(db, "large", HIT_ONES, "hit-train", { family: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" }, role: "EFFECT" });
      const prepared = prepareLuna(db, { mode: "residue", faction_id: "zeta" });
      const request = prepared.request as { abilities: Array<{ ability_id: string; uncovered_regions: Array<{ text: string }> }> };
      expect(request.abilities.map((entry) => entry.ability_id)).toEqual(["large", "small"]);
      expect(request.abilities[0]!.uncovered_regions.some((region) => region.text.includes("Re-roll"))).toBe(false);
      expect(() => prepareLuna(db, { mode: "everything" as never })).toThrow(/coverage or residue/);
    } finally {
      db.close();
    }
  });
});

describe("Round 5C leaf progress", () => {
  it("reports composition readiness only when leaves cover the source and nothing is open", () => {
    const db = fixture([
      { id: "complete", faction_id: "zeta", raw_text: `${HIT_ONES}.` },
      { id: "partial", faction_id: "zeta", raw_text: `Deploy anywhere. ${HIT_ONES}.` },
    ]);
    try {
      seed(db, "complete", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
      seed(db, "partial", HIT_ONES, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
      const complete = getAbility(db, ability(db, "complete").id);
      expect(complete.progress).toMatchObject({
        leaves: [{ family_id: "reroll", authority_kind: "human", count: 1 }],
        pending_proposals: 0,
        residue_regions: 0,
        composition_ready: true,
      });
      const partial = getAbility(db, ability(db, "partial").id).progress;
      expect(partial).toMatchObject({ composition_ready: false, residue_regions: 1 });
      expect(getDashboard(db)).toMatchObject({ composition_ready_abilities: 1 });

      // An unreviewed proposal on otherwise complete source still blocks composition.
      pendingProposal(db, "complete", "Re-roll", "luna", null);
      expect(getAbility(db, ability(db, "complete").id).progress).toMatchObject({ unresolved_proposals: 1, composition_ready: false });
      expect(getDashboard(db)).toMatchObject({ composition_ready_abilities: 0 });
    } finally {
      db.close();
    }
  });
});

describe("Round 5C untouched-source queue entry", () => {
  it("offers one deterministic analyze item per faction until a claim, run, or review touches the source", () => {
    const db = fixture([
      { id: "b-short", faction_id: "alpha", raw_text: "Short fixture text." },
      { id: "a-long", faction_id: "alpha", raw_text: "A much longer fabricated fixture clause for review." },
      { id: "other", faction_id: "zeta", raw_text: "Zeta fixture text." },
    ]);
    try {
      const unparsed = () => getQueue(db, { limit: 200 }).items.filter((item) => item.kind === "unparsed-source");
      const first = unparsed();
      expect(first.map((item) => item.key)).toEqual(["unparsed:alpha", "unparsed:zeta"]);
      const longest = ability(db, "a-long");
      expect(first[0]).toMatchObject({ backlog: 2, target: { view: "abilities", ability_version_id: longest.id, action: "analyze-source" } });

      // A pending source-decomposition run excludes its ability whatever the run's model label is.
      const run = prepareLuna(db, { ability_version_id: longest.id });
      expect(db.prepare("SELECT model FROM model_runs WHERE id = ?").get(Number(run.run_id))).toEqual({ model: "external" });
      expect(unparsed()[0]).toMatchObject({ backlog: 1, target: { ability_version_id: ability(db, "b-short").id } });
      expect(getQueue(db, { limit: 200 }).items.find((item) => item.kind === "luna")?.why).toContain("across 2 abilities");

      pendingProposal(db, "b-short", "Short fixture text", "manual", null);
      expect(unparsed().map((item) => item.key)).toEqual(["unparsed:zeta"]);
    } finally {
      db.close();
    }
  });
});


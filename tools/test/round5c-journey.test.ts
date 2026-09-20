import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applySourceAtomBatch } from "../src/round5c/atoms.js";
import { getDraft, listDrafts } from "../src/round5c/assembly.js";
import { openWorkbench } from "../src/round5c/db.js";
import { runLuna } from "../src/round5c/luna-run.js";
import { LUNA_MODEL } from "../src/round5c/luna-schema.js";
import { prepareLuna } from "../src/round5c/proposal.js";
import { preparePublication, publishPublication } from "../src/round5c/publish.js";
import { getQueue } from "../src/round5c/queue.js";
import { abilityReadiness } from "../src/round5c/readiness.js";
import { applyAnnotationBatch, reviewAbility } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";
import { approveStamp, previewStamp, stampApprovalEligibility } from "../src/round5c/stamps.js";
import { abilityRoundTrip } from "../src/round5c/round-trip.js";
import { importWork, prepareWork, type PreparedWork } from "../src/round5c/work.js";

// Fabricated prose for a real stub entity; no published source text appears in this test.
const FACTION = "adepta-sororitas";
const ABILITY = "anchorite-sarcophagus";
const SOURCE = "Squad models re-roll a Hit roll of 1 and re-roll a Wound roll of 1.";
const REVIEWER = "journey-reviewer";
const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

let root: string;
let databasePath: string;
let dataRoot: string;
let rawStore: string;
let abilitiesFile: string;
let binary: string;
const saved: Record<string, string | undefined> = {};

function open(): DatabaseSync {
  return openWorkbench(databasePath);
}

function bytes(text: string, source = SOURCE): { start_byte: number; end_byte: number; exact_text: string } {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { start_byte: Buffer.byteLength(source.slice(0, start)), end_byte: Buffer.byteLength(source.slice(0, start + text.length)), exact_text: text };
}

function writeRawStore(text: string): void {
  writeFileSync(join(rawStore, `${FACTION}.json`), JSON.stringify([{ faction_id: FACTION, ability_id: ABILITY, name: "Fixture journey ability", ability_type: "unit", raw_text: text }]));
}

// One copy of the dataset per file; each test restores the only file it mutates.
let sharedRoot: string;
beforeAll(() => {
  sharedRoot = mkdtempSync(join(tmpdir(), "round5c-journey-data-"));
  cpSync(join(repositoryRoot, "data"), join(sharedRoot, "data"), { recursive: true });
});
afterAll(() => rmSync(sharedRoot, { recursive: true, force: true }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "round5c-journey-"));
  databasePath = join(root, "workbench.sqlite");
  dataRoot = join(sharedRoot, "data");
  abilitiesFile = join(dataRoot, "enrichment", FACTION, "abilities.json");
  const entries = JSON.parse(readFileSync(join(repositoryRoot, "data", "enrichment", FACTION, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const target = entries.find((entry) => entry.ability_id === ABILITY)!;
  target.effect = { type: "stat-modifier", target: "self", modifier: {} };
  target.behavior = "reactive";
  writeFileSync(abilitiesFile, `${JSON.stringify(entries, null, 2)}\n`);
  rawStore = join(root, "raw-store");
  mkdirSync(rawStore);
  writeRawStore(SOURCE);
  for (const key of ["ROUND5C_DATA_ROOT", "RAW_TEXT_STORE", "ROUND5C_ARTIFACT_DIR", "FAKE_OMP_BODY"]) saved[key] = process.env[key];
  process.env.ROUND5C_DATA_ROOT = dataRoot;
  process.env.RAW_TEXT_STORE = rawStore;
  process.env.ROUND5C_ARTIFACT_DIR = join(root, "artifacts");
  binary = join(root, "fake-omp.mjs");
  writeFileSync(binary, `#!/usr/bin/env node
import { readFileSync } from "node:fs";
if (process.argv[2] === "--version") { process.stdout.write("omp/0.0.0-journey\\n"); process.exit(0); }
readFileSync(0, "utf8");
const body = readFileSync(process.env.FAKE_OMP_BODY, "utf8");
const message = { role: "assistant", content: [{ type: "text", text: body }], provider: "openai-codex", model: "gpt-5.6-luna", stopReason: "stop", usage: { cost: { total: 0 } }, duration: 3 };
for (const event of [{ type: "session" }, { type: "message_start", message }, { type: "message_end", message }, { type: "agent_end", messages: [message] }]) process.stdout.write(JSON.stringify(event) + "\\n");
`);
  chmodSync(binary, 0o755);
  process.env.FAKE_OMP_BODY = join(root, "body.json");
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

function abilityRow(db: DatabaseSync): { id: number; source_hash: string } {
  return db.prepare("SELECT id, source_hash FROM abilities WHERE faction_id = ? AND ability_id = ? AND current = 1").get(FACTION, ABILITY) as { id: number; source_hash: string };
}

/** Refresh, analyze through the fake OMP binary, and review every constituent to readiness. */
async function reviewedSource(): Promise<{ id: number; hash: string; escalation: string }> {
  const db = open();
  refreshSources(db, rawStore);
  const ability = abilityRow(db);
  const item = getQueue(db, { factionId: FACTION, limit: 200 }).items.find((entry) => entry.kind === "unparsed-source");
  expect(item?.target).toMatchObject({ view: "abilities", action: "analyze-source" });
  const run = prepareLuna(db, { ability_version_id: ability.id });
  const request = run.request as { abilities: Array<{ faction_id: string; ability_id: string; source_hash: string }> };
  writeFileSync(process.env.FAKE_OMP_BODY!, JSON.stringify({
    schema_version: 2, input_hash: run.input_hash, model: LUNA_MODEL, model_version: "unknown", prompt_version: "v2",
    abilities: [{
      faction_id: request.abilities[0]!.faction_id, ability_id: request.abilities[0]!.ability_id, source_hash: request.abilities[0]!.source_hash,
      spans: [
        { ...bytes("re-roll a Hit roll of 1"), role: "EFFECT", status: "EXISTING", family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "ones" } },
        { ...bytes("re-roll a Wound roll of 1"), role: "EFFECT", status: "EXISTING", family_id: "reroll", family_version: 1, parameters: { roll: "wound", subset: "ones" } },
      ],
      structural_spans: [{ ...bytes("Squad models"), kind: "participant", description: "Who re-rolls." }],
      connectives: [{ ...bytes(" and ".trim()), kind: "and" }],
      unresolved_regions: [],
    }],
  }));
  db.close();
  const view = await runLuna(open, run.run_id, { binary });
  expect(view).toMatchObject({ state: "completed", model: LUNA_MODEL });

  const review = open();
  try {
    expect(review.prepare("SELECT count(*) AS total FROM annotations").get()).toEqual({ total: 0 });
    expect(abilityReadiness(review, ability.id).ready).toBe(false);
    const proposals = review.prepare(`
      SELECT proposals.id, proposals.role, source_spans.exact_text FROM proposals
      JOIN source_spans ON source_spans.id = proposals.span_id WHERE proposals.status = 'pending' ORDER BY source_spans.start_byte
    `).all() as Array<{ id: number; role: string; exact_text: string }>;
    const decision = (proposal: { id: number; role: string; exact_text: string }) => ({
      action: proposal.role === "CONNECTIVE" ? "confirm-connective" : "confirm",
      proposal_id: proposal.id, ability_version_id: ability.id, source_hash: ability.source_hash, fragment: "RAW_TEXT",
      ...bytes(proposal.exact_text), role: proposal.role, ...(proposal.role === "CONNECTIVE" ? { relation: "coexists-with" } : {}),
    });
    applyAnnotationBatch(review, { reviewer: REVIEWER, decisions: proposals.map(decision) });
    const atom = review.prepare("SELECT id FROM source_atom_proposals WHERE status = 'pending'").get() as { id: number };
    applySourceAtomBatch(review, { reviewer: REVIEWER, decisions: [{ atom_proposal_id: atom.id, action: "accept", source_hash: ability.source_hash }] });
    expect(abilityReadiness(review, ability.id)).toMatchObject({ ready: true, accounted_fraction: 1 });
    reviewAbility(review, ability.id, { source_hash: ability.source_hash, reviewer: REVIEWER, whole_context_checked: true });
    const escalations = review.prepare("SELECT id FROM escalations WHERE reason_code = 'COMPOSITION_GAP' AND state = 'open'").all() as Array<{ id: string }>;
    expect(escalations).toHaveLength(1);
    expect(getQueue(review, { factionId: FACTION }).items.some((entry) => entry.kind === "composition")).toBe(true);
    return { id: ability.id, hash: ability.source_hash, escalation: escalations[0]!.id };
  } finally {
    review.close();
  }
}

type Overrides = { relations?: unknown[]; mechanics?: unknown; whoLiteral?: string; hitSubset?: string };

function compositionDefinition(overrides: Overrides = {}): Record<string, unknown> {
  const evidence = (first: string, last = first) => ({ fragment: "RAW_TEXT", first_segment_id: first, last_segment_id: last });
  const reroll = (leaf: string) => ({ type: "re-roll", target: "unit", modifier: { roll: { $bind: `${leaf}.parameters.roll` }, subset: "ones" } });
  return {
    schema_version: 1, kind: "composition", label: "Journey paired re-rolls",
    variants: [{
      id: "mapped", source_types: ["unit"], slots: {},
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "who", literal: overrides.whoLiteral ?? "squad models" }, { id: "gap", literal: " " },
        { id: "hit_leaf", leaf: { family_id: "reroll", family_version: 1 } }, { id: "join", literal: " and " },
        { id: "wound_leaf", leaf: { family_id: "reroll", family_version: 1 } }, { id: "end", literal: "." },
      ] }],
      graph_template: {
        schema_version: 1,
        nodes: [
          { id: "beneficiary", kind: "participant", parameters: { target: "unit" }, evidence: evidence("who") },
          { id: "hit", kind: "leaf", family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "hit_leaf.parameters.roll" }, subset: overrides.hitSubset ?? { $bind: "hit_leaf.parameters.subset" } }, evidence: evidence("hit_leaf") },
          { id: "wound", kind: "leaf", family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "wound_leaf.parameters.roll" }, subset: { $bind: "wound_leaf.parameters.subset" } }, evidence: evidence("wound_leaf") },
        ],
        relations: overrides.relations ?? [
          { id: "hit_targets", type: "targets", from_node_id: "hit", to_node_id: "beneficiary", evidence: evidence("who", "hit_leaf") },
          { id: "both", type: "coexists-with", from_node_id: "hit", to_node_id: "wound", evidence: evidence("hit_leaf", "wound_leaf") },
        ],
        roots: ["hit", "wound"],
      },
      mechanics_template: overrides.mechanics === undefined ? {
        effect: { type: "sequence", steps: [reroll("hit_leaf"), reroll("wound_leaf")] },
        scope: { range: "unit", duration: "permanent" }, behavior: "passive", trigger: null, usage: null, applies_to: null,
      } : overrides.mechanics,
    }],
  };
}

function workResponse(prepared: PreparedWork, result: (item: PreparedWork["request"]["items"][number]) => Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 1, run_id: prepared.run_id, input_hash: prepared.input_hash, model: "fixture-model", model_version: "fixture",
    prompt_version: "round5c-work/v1", latency_ms: 1, cost_usd: 0,
    items: prepared.request.items.map((item) => ({ item_id: item.item_id, evidence_hash: item.evidence_hash, result: result(item) })),
  };
}

function wholeSource(id: number, hash: string) {
  return { ability_version_id: id, source_hash: hash, fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(SOURCE), exact_text: SOURCE };
}

/** Scripted propose-rule then an independent clear challenge; returns the proposed stamp. */
function proposeAndChallenge(db: DatabaseSync, source: { id: number; hash: string; escalation: string }, overrides: Overrides = {}, verdict: "clear" | "objection" = "clear"): { stamp_id: string; revision: number } {
  const proposal = prepareWork(db, { purpose: "propose-rule", ids: [source.escalation] });
  const item = proposal.request.items[0]!;
  expect((item as unknown as { reviewed_structure: Array<{ structural: unknown[]; connectives: unknown[] }> }).reviewed_structure[0])
    .toMatchObject({ structural: [expect.objectContaining({ kind: "participant" })], connectives: [expect.objectContaining({ kind: "and", allowed_relations: ["coexists-with"] })] });
  const imported = importWork(db, { run_id: proposal.run_id, response: workResponse(proposal, (entry) => ({
    definition: compositionDefinition(overrides), positives: [wholeSource(source.id, source.hash)], counterexamples: [], closest_stamp_ids: [],
    exact_mismatch: "No composition covers this reviewed source.", question: "Is this the complete paired re-roll?",
    affected_member_ids: (entry as unknown as { escalation: { members: Array<{ member_id: string }> } }).escalation.members.map((member) => member.member_id),
  })) });
  if (imported.imported !== 1) throw new Error(`propose-rule import failed: ${imported.items[0]?.reason}`);
  const stamp = db.prepare("SELECT id, revision FROM stamps WHERE kind = 'composition' AND status = 'proposed' ORDER BY created_at DESC LIMIT 1").get() as { id: string; revision: number };
  const challenge = prepareWork(db, { purpose: "challenge-rule", ids: [`${stamp.id}@${stamp.revision}`] });
  importWork(db, { run_id: challenge.run_id, response: workResponse(challenge, () => verdict === "clear"
    ? { verdict: "clear", findings: [] }
    : { verdict: "objection", findings: [{ message: "The pairing may be conditional.", evidence: wholeSource(source.id, source.hash) }] }) });
  return { stamp_id: stamp.id, revision: stamp.revision };
}

function approve(db: DatabaseSync, stamp: { stamp_id: string; revision: number }): void {
  const preview = previewStamp(db, stamp.stamp_id, stamp.revision);
  approveStamp(db, stamp.stamp_id, stamp.revision, { reviewer: REVIEWER, preview_hash: preview.preview_hash });
}

function verify(db: DatabaseSync, draftId: string, faithful: boolean, source: { id: number; hash: string }): void {
  const prepared = prepareWork(db, { purpose: "verify-draft", ids: [draftId] });
  importWork(db, { run_id: prepared.run_id, response: workResponse(prepared, () => faithful
    ? { faithful: true, severity: "ok", findings: [] }
    : { faithful: false, severity: "wrong", findings: [{ message: "The render drops the pairing.", evidence: wholeSource(source.id, source.hash) }] }) });
}

describe("Round 5C end-to-end journey", () => {
  it("drives an untouched source from OMP decomposition through review, composition, verification, and guarded publication", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      const stamp = proposeAndChallenge(db, source);
      expect(stampApprovalEligibility(db, stamp.stamp_id, stamp.revision).approvable).toBe(true);
      // Before approval, the round trip shows exactly what the rule would author and say.
      const trip = abilityRoundTrip(db, source.id);
      expect(trip.decomposition.map((part) => part.kind)).toEqual(["structural", "leaf", "leaf", "connective"]);
      expect(trip.rules).toEqual([expect.objectContaining({ stamp_id: stamp.stamp_id, status: "proposed", warnings: [], errors: [], challenge: "clear" })]);
      expect(trip.rules[0]!.rendered_text).toMatch(/Hit/u);
      expect(trip.rules[0]!.rendered_text).toMatch(/Wound/u);
      approve(db, stamp);
      const draft = listDrafts(db).items[0] as { id: string; status: string };
      expect(draft.status).toBe("proposed");
      expect(getDraft(db, draft.id).mechanics).toMatchObject({ effect: { type: "sequence" } });

      const trackedBefore = readFileSync(abilitiesFile, "utf8");
      verify(db, draft.id, true, source);
      const accepted = getDraft(db, draft.id) as { status: string; publication: { prepare: string } | null };
      expect(accepted.status).toBe("accepted");
      expect(accepted.publication?.prepare).toContain(`prepare-publication -- ${FACTION} ${draft.id}`);
      // An accepted draft is not authored data until the guarded publication runs.
      expect(readFileSync(abilitiesFile, "utf8")).toBe(trackedBefore);

      const prepared = await preparePublication(db, { faction_id: FACTION, draft_ids: [draft.id], reauthor: false }) as { batch_id: string; preview_hash: string };
      expect(readFileSync(abilitiesFile, "utf8")).toBe(trackedBefore);
      const published = await publishPublication(db, { batch_id: prepared.batch_id, preview_hash: prepared.preview_hash }) as { state?: string };
      expect(published).toBeTruthy();
      const entry = (JSON.parse(readFileSync(abilitiesFile, "utf8")) as Array<Record<string, unknown>>).find((item) => item.ability_id === ABILITY)!;
      expect(entry.effect).toEqual({ type: "sequence", steps: [
        { type: "re-roll", target: "unit", modifier: { roll: "hit", subset: "ones" } },
        { type: "re-roll", target: "unit", modifier: { roll: "wound", subset: "ones" } },
      ] });
      expect((getDraft(db, draft.id) as { publication: { latest_batch: { state: string } | null } }).publication?.latest_batch?.state).toBe("published");
    } finally {
      db.close();
    }
  }, 60_000);

  it("flags a rule whose graph leaf disagrees with the reviewed leaf before anyone approves it", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      proposeAndChallenge(db, source, { hitSubset: "all" });
      const [rule] = abilityRoundTrip(db, source.id).rules;
      expect(rule!.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/Graph leaf hit .* matches no reviewed leaf/u),
        expect.stringMatching(/Reviewed EFFECT "re-roll a Hit roll of 1" .* missing from the graph/u),
      ]));
    } finally {
      db.close();
    }
  }, 60_000);

  it("blocks an unwitnessed connective as a relation gap with no draft", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      approve(db, proposeAndChallenge(db, source, { relations: [{ id: "hit_targets", type: "targets", from_node_id: "hit", to_node_id: "beneficiary", evidence: { fragment: "RAW_TEXT", first_segment_id: "who", last_segment_id: "hit_leaf" } }] }));
      expect(listDrafts(db).total).toBe(0);
      const gap = db.prepare("SELECT question_json FROM escalations WHERE reason_code = 'RELATION_GAP' AND state = 'open'").get() as { question_json: string };
      expect(JSON.parse(gap.question_json).error).toMatch(/and connective .* no coexists-with relation/u);
    } finally {
      db.close();
    }
  }, 60_000);

  it("keeps a null-mechanics draft as a DSL gap that cannot be verified or published", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      approve(db, proposeAndChallenge(db, source, { mechanics: null }));
      const draft = listDrafts(db).items[0] as { id: string; status: string };
      expect(draft.status).toBe("blocked");
      expect(getDraft(db, draft.id).diagnostic).toMatchObject({ reason_code: "DSL_GAP" });
      expect(() => prepareWork(db, { purpose: "verify-draft", ids: [draft.id] })).toThrow();
      await expect(preparePublication(db, { faction_id: FACTION, draft_ids: [draft.id], reauthor: false })).rejects.toThrow();
    } finally {
      db.close();
    }
  }, 60_000);

  it("refuses a rule with no complete source match and leaves the composition gap open", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      expect(() => proposeAndChallenge(db, source, { whoLiteral: "squad heroes" })).toThrow(/propose-rule import failed/u);
      expect(db.prepare("SELECT count(*) AS total FROM stamps WHERE kind = 'composition'").get()).toEqual({ total: 0 });
      expect(db.prepare("SELECT state FROM escalations WHERE id = ?").get(source.escalation)).toEqual({ state: "open" });
    } finally {
      db.close();
    }
  }, 60_000);

  it("blocks approval after an unresolved challenge objection", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      const stamp = proposeAndChallenge(db, source, {}, "objection");
      expect(stampApprovalEligibility(db, stamp.stamp_id, stamp.revision)).toMatchObject({ approvable: false });
      expect(() => approve(db, stamp)).toThrow();
    } finally {
      db.close();
    }
  }, 60_000);

  it("blocks a rejected verifier verdict and a stale source from publication", async () => {
    const source = await reviewedSource();
    const db = open();
    try {
      approve(db, proposeAndChallenge(db, source));
      const draft = listDrafts(db).items[0] as { id: string };
      verify(db, draft.id, false, source);
      expect(getDraft(db, draft.id).status).toBe("blocked");
      await expect(preparePublication(db, { faction_id: FACTION, draft_ids: [draft.id], reauthor: false })).rejects.toThrow();

      writeRawStore(`${SOURCE} Then more.`);
      refreshSources(db, rawStore);
      expect(getDraft(db, draft.id).status).toBe("stale");
    } finally {
      db.close();
    }
  }, 60_000);

  it("blocks a composition whose entity is missing from the dataset", async () => {
    const source = await reviewedSource();
    const entries = (JSON.parse(readFileSync(abilitiesFile, "utf8")) as Array<Record<string, unknown>>).filter((entry) => entry.ability_id !== ABILITY);
    writeFileSync(abilitiesFile, `${JSON.stringify(entries, null, 2)}\n`);
    const db = open();
    try {
      approve(db, proposeAndChallenge(db, source));
      const draft = listDrafts(db).items[0] as { id: string };
      expect(getDraft(db, draft.id)).toMatchObject({ status: "blocked", diagnostic: { reason_code: "ENTITY_RESOLUTION" } });
    } finally {
      db.close();
    }
  }, 60_000);
});

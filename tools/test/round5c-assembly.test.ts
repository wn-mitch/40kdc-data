import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { draftVerificationSnapshot, getDraft, listDrafts, recordDraftVerification, schemaTreeHash } from "../src/round5c/assembly.js";
import { hashJson } from "../src/round4/hash.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { getQueue } from "../src/round5c/queue.js";
import { applyAnnotationBatch } from "../src/round5c/review.js";
import { applySourceAtomBatch, proposeSourceAtom } from "../src/round5c/atoms.js";
import { applyStamps, approveStamp, previewStamp, proposeStamp } from "../src/round5c/stamps.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

type AbilityFixture = {
  id: number;
  abilityId: string;
  source: string;
  sourceHash: string;
};

type AssemblyFixture = {
  db: DatabaseSync;
  stampId: string;
  stampRevision: number;
  abilities: Record<string, AbilityFixture>;
  entitiesFile: string;
  entities: Array<Record<string, unknown>>;
};

const directories: string[] = [];
const originalDataRoot = process.env.ROUND5C_DATA_ROOT;

afterEach(() => {
  if (originalDataRoot === undefined) delete process.env.ROUND5C_DATA_ROOT;
  else process.env.ROUND5C_DATA_ROOT = originalDataRoot;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const completeSource = (rerollText: string, participant = "squad models") =>
  `Lead-state active; ${participant} ${rerollText}.`;

function addAbility(
  db: DatabaseSync,
  abilityId: string,
  source: string,
  fragments?: Array<{ fragment: string; start_byte: number; end_byte: number; text: string }>,
): AbilityFixture {
  const sourceHash = hashJson({ ability_id: abilityId, source });
  const storedFragments = fragments ?? [{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }];
  const inserted = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, sourceHash, source, abilityId, JSON.stringify(storedFragments));
  return { id: Number(inserted.lastInsertRowid), abilityId, source, sourceHash };
}

function sourceReference(ability: AbilityFixture) {
  return {
    ability_version_id: ability.id,
    source_hash: ability.sourceHash,
    fragment: "RAW_TEXT",
    start_byte: 0,
    end_byte: Buffer.byteLength(ability.source, "utf8"),
    exact_text: ability.source,
  };
}

function confirmLeaf(
  db: DatabaseSync,
  ability: AbilityFixture,
  exactText: string,
  role: "EFFECT" | "CONDITION",
  familyId: "reroll" | "leading-unit",
  parameters: Record<string, unknown>,
): void {
  const characterStart = ability.source.indexOf(exactText);
  if (characterStart < 0) throw new Error(`Fixture source does not contain ${exactText}.`);
  const startByte = Buffer.byteLength(ability.source.slice(0, characterStart), "utf8");
  applyAnnotationBatch(db, {
    reviewer: "fixture-reviewer",
    decisions: [{
      action: "confirm",
      ability_version_id: ability.id,
      source_hash: ability.sourceHash,
      fragment: "RAW_TEXT",
      start_byte: startByte,
      end_byte: startByte + Buffer.byteLength(exactText, "utf8"),
      exact_text: exactText,
      role,
      family_id: familyId,
      family_version: 1,
      parameters,
    }],
  });
}

/** Review the participant phrase as a structural constituent, as composition now requires. */
function reviewParticipant(db: DatabaseSync, ability: AbilityFixture, exactText: string): void {
  const characterStart = ability.source.indexOf(exactText);
  if (characterStart < 0) throw new Error(`Fixture source does not contain ${exactText}.`);
  const startByte = Buffer.byteLength(ability.source.slice(0, characterStart), "utf8");
  const proposed = proposeSourceAtom(db, {
    ability_version_id: ability.id,
    source_hash: ability.sourceHash,
    fragment: "RAW_TEXT",
    start_byte: startByte,
    end_byte: startByte + Buffer.byteLength(exactText, "utf8"),
    exact_text: exactText,
    kind: "participant",
    description: "Who benefits from the re-roll.",
    reviewer: "fixture-reviewer",
  });
  applySourceAtomBatch(db, {
    reviewer: "fixture-reviewer",
    decisions: [{ atom_proposal_id: proposed.proposal_id, action: "accept", source_hash: ability.sourceHash }],
  });
}

function graphTemplate() {
  return {
    schema_version: 1,
    nodes: [{
      id: "leading_condition",
      kind: "leaf",
      family_id: "leading-unit",
      family_version: 1,
      parameters: { subject: { $bind: "condition_leaf.parameters.subject" } },
      evidence: { fragment: "RAW_TEXT", first_segment_id: "condition_leaf", last_segment_id: "condition_leaf" },
    }, {
      id: "beneficiary",
      kind: "participant",
      parameters: { target: { $bind: "participant" } },
      evidence: { fragment: "RAW_TEXT", first_segment_id: "participant_form", last_segment_id: "participant_form" },
    }, {
      id: "reroll_effect",
      kind: "leaf",
      family_id: "reroll",
      family_version: 1,
      parameters: { roll: { $bind: "reroll_leaf.parameters.roll" }, subset: { $bind: "reroll_leaf.parameters.subset" } },
      evidence: { fragment: "RAW_TEXT", first_segment_id: "reroll_leaf", last_segment_id: "reroll_leaf" },
    }],
    relations: [{
      id: "condition_controls_effect",
      type: "condition-of",
      from_node_id: "leading_condition",
      to_node_id: "reroll_effect",
      evidence: { fragment: "RAW_TEXT", first_segment_id: "condition_leaf", last_segment_id: "reroll_leaf" },
    }, {
      id: "effect_targets_beneficiary",
      type: "targets",
      from_node_id: "reroll_effect",
      to_node_id: "beneficiary",
      evidence: { fragment: "RAW_TEXT", first_segment_id: "participant_form", last_segment_id: "reroll_leaf" },
    }],
    roots: ["reroll_effect"],
  };
}

function mechanicsTemplate() {
  return {
    effect: {
      type: "conditional",
      condition: { type: "model-is-leader" },
      effect: {
        type: "re-roll",
        target: { $bind: "participant" },
        modifier: {
          $case: "reroll_leaf.parameters.subset",
          cases: [{
            value: "all",
            then: { roll: { $bind: "reroll_leaf.parameters.roll" }, result_scope: "any-result" },
          }, {
            value: "failed",
            then: { roll: { $bind: "reroll_leaf.parameters.roll" }, subset: "all-failures" },
          }, {
            value: "ones",
            then: { roll: { $bind: "reroll_leaf.parameters.roll" }, subset: "ones" },
          }],
        },
      },
    },
    scope: { range: "unit", duration: "permanent" },
    behavior: "passive",
    trigger: null,
    usage: null,
    applies_to: null,
  };
}

function compositionDefinition() {
  const segments = [
    { id: "condition_leaf", leaf: { family_id: "leading-unit", family_version: 1 } },
    { id: "condition_joiner", literal: "; " },
    { id: "participant_form", slot: "participant" },
    { id: "participant_joiner", literal: " " },
    { id: "reroll_leaf", leaf: { family_id: "reroll", family_version: 1 } },
    { id: "terminator", literal: "." },
  ];
  return {
    schema_version: 1 as const,
    kind: "composition" as const,
    label: "Fixture leading-unit reroll composition",
    variants: [{
      id: "mapped",
      source_types: ["unit"],
      fragments: [{ fragment: "RAW_TEXT", segments }],
      slots: { participant: { kind: "enum" as const, values: [{ text: "squad models", value: "unit" }] } },
      graph_template: graphTemplate(),
      mechanics_template: mechanicsTemplate(),
    }, {
      id: "graph_only",
      source_types: ["unit"],
      fragments: [{ fragment: "RAW_TEXT", segments }],
      slots: { participant: { kind: "enum" as const, values: [{ text: "guide", value: "self" }] } },
      graph_template: graphTemplate(),
      mechanics_template: null,
    }],
  };
}

function attachClearChallenge(db: DatabaseSync, stampId: string, stampRevision: number): void {
  const stamp = db.prepare("SELECT definition_hash FROM stamps WHERE id=? AND revision=?")
    .get(stampId, stampRevision) as { definition_hash: string };
  const run = db.prepare(`
    INSERT INTO model_runs (
      model, model_version, prompt_version, input_hash, config_json, output_json, status, created_at
    ) VALUES ('fixture-challenger', 'fixture-version', 'fixture-challenge-v1', ?, '{}', ?, 'completed', '2026-01-01T00:00:00.000Z')
  `).run("c".repeat(64), JSON.stringify({ definition_hash: stamp.definition_hash, verdict: "clear" }));
  db.prepare("UPDATE stamps SET challenge_run_id=? WHERE id=? AND revision=?")
    .run(Number(run.lastInsertRowid), stampId, stampRevision);
}

function insertVerifierRun(
  db: DatabaseSync,
  draftId: string,
  evidenceHash: string,
  result: { faithful: boolean; severity: "ok" | "minor" | "wrong"; findings: unknown[] },
): number {
  const output = { items: [{ item_id: draftId, evidence_hash: evidenceHash, result }] };
  const run = db.prepare(`
    INSERT INTO model_runs (
      model, model_version, prompt_version, input_hash, config_json, output_json, status, created_at
    ) VALUES ('fixture-verifier', 'fixture-version', 'fixture-verify-v1', ?, '{}', ?, 'completed', '2026-01-01T00:00:00.000Z')
  `).run(hashJson({ draft_id: draftId, evidence_hash: evidenceHash }), JSON.stringify(output));
  return Number(run.lastInsertRowid);
}

function buildFixture(): AssemblyFixture {
  const dataRoot = mkdtempSync(join(tmpdir(), "round5c-assembly-"));
  directories.push(dataRoot);
  const factionDirectory = join(dataRoot, "enrichment", "fixture");
  mkdirSync(factionDirectory, { recursive: true });
  process.env.ROUND5C_DATA_ROOT = dataRoot;

  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  const abilities: Record<string, AbilityFixture> = {
    all: addAbility(db, "all-results", completeSource("repeat any Hit result")),
    failed: addAbility(db, "failed-results", completeSource("repeat failed Hit results")),
    ones: addAbility(db, "ones-results", completeSource("repeat Hit results marked one")),
    missingEntity: addAbility(db, "missing-entity", completeSource("repeat any Hit result")),
    dslGap: addAbility(db, "dsl-gap", completeSource("repeat any Hit result", "guide")),
    changedClause: addAbility(db, "changed-clause", "Lead-state active plus squad models repeat any Hit result."),
  };
  const fragmentBase = completeSource("repeat any Hit result");
  const fragmentMismatchSource = `${fragmentBase} Separate limiter.`;
  abilities.fragmentMismatch = addAbility(db, "fragment-mismatch", fragmentMismatchSource, [{
    fragment: "RAW_TEXT",
    start_byte: 0,
    end_byte: Buffer.byteLength(fragmentBase, "utf8"),
    text: fragmentBase,
  }, {
    fragment: "RESTRICTIONS",
    start_byte: Buffer.byteLength(`${fragmentBase} `, "utf8"),
    end_byte: Buffer.byteLength(fragmentMismatchSource, "utf8"),
    text: "Separate limiter.",
  }]);

  const entities = Object.values(abilities)
    .filter((ability) => ability.abilityId !== "missing-entity")
    .map((ability) => ({
      ability_id: ability.abilityId,
      name: ability.abilityId,
      authored_by: "fixture",
      game_version: { edition: "11th", dataslate: "fixture-version" },
      faction_id: "fixture",
      ability_type: "unit",
      behavior: "reactive",
      effect: { type: "custom", target: "unit" },
      scope: { range: "unit", duration: "permanent" },
      community_notes: `fixture-note-${ability.abilityId}`,
    })) as Array<Record<string, unknown>>;
  const entitiesFile = join(factionDirectory, "abilities.json");
  writeFileSync(entitiesFile, JSON.stringify(entities));

  const rerollTextByKey: Record<string, { text: string; subset: "all" | "failed" | "ones" }> = {
    all: { text: "repeat any Hit result", subset: "all" },
    failed: { text: "repeat failed Hit results", subset: "failed" },
    ones: { text: "repeat Hit results marked one", subset: "ones" },
    missingEntity: { text: "repeat any Hit result", subset: "all" },
    dslGap: { text: "repeat any Hit result", subset: "all" },
    changedClause: { text: "repeat any Hit result", subset: "all" },
    fragmentMismatch: { text: "repeat any Hit result", subset: "all" },
  };
  for (const [key, ability] of Object.entries(abilities)) {
    confirmLeaf(db, ability, "Lead-state active", "CONDITION", "leading-unit", { subject: "this-model" });
    const reroll = rerollTextByKey[key]!;
    confirmLeaf(db, ability, reroll.text, "EFFECT", "reroll", { roll: "hit", subset: reroll.subset });
    reviewParticipant(db, ability, key === "dslGap" ? "guide" : "squad models");
  }

  const proposed = proposeStamp(db, {
    definition: compositionDefinition(),
    positives: [sourceReference(abilities.all!)],
    counterexamples: [sourceReference(abilities.changedClause!)],
  });
  attachClearChallenge(db, proposed.stamp_id, proposed.revision);
  const preview = previewStamp(db, proposed.stamp_id, proposed.revision);
  expect(preview.totals).toEqual({ eligible: 5, already_satisfied: 0, blocked: 0 });
  // A proposed composition rule is a decision the queue must surface, not a leaf-only blind spot.
  const compositionStamp = getQueue(db).items.find((item) => item.key === `stamp:${proposed.stamp_id}@${proposed.revision}`);
  expect(compositionStamp).toMatchObject({
    kind: "stamp",
    unlocks: 5,
    backlog: 5,
    target: { view: "stamps", stamp_id: proposed.stamp_id, revision: proposed.revision },
  });
  expect(compositionStamp?.why).toContain("Composition stamp");


  expect(approveStamp(db, proposed.stamp_id, proposed.revision, {
    reviewer: "fixture-reviewer",
    preview_hash: preview.preview_hash,
  })).toMatchObject({ applied: 3, blocked: 2 });

  return { db, stampId: proposed.stamp_id, stampRevision: proposed.revision, abilities, entitiesFile, entities };
}

describe("Round 5C composition assembly", () => {
  it("persists a grounded source graph and complete schema-valid reroll mechanics only for complete matches", () => {
    const fixture = buildFixture();
    try {
      const page = listDrafts(fixture.db);
      expect(page.total).toBe(5);
      const byAbility = new Map(page.items.map((draft) => [draft.ability_version_id, draft]));
      expect(byAbility.has(fixture.abilities.changedClause!.id)).toBe(false);
      expect(byAbility.has(fixture.abilities.fragmentMismatch!.id)).toBe(false);

      const expectedModifiers: Record<string, Record<string, unknown>> = {
        all: { roll: "hit", result_scope: "any-result" },
        failed: { roll: "hit", subset: "all-failures" },
        ones: { roll: "hit", subset: "ones" },
      };
      for (const key of ["all", "failed", "ones"] as const) {
        const draft = byAbility.get(fixture.abilities[key].id)!;
        expect(draft.status).toBe("proposed");
        expect(draft.verifier_run_id).toBeNull();
        expect(draft.graph).toMatchObject({
          schema_version: 1,
          roots: ["reroll_effect"],
          nodes: [{
            id: "leading_condition",
            kind: "leaf",
            family_id: "leading-unit",
            parameters: { subject: "this-model" },
            evidence: { exact_text: "Lead-state active" },
          }, {
            id: "beneficiary",
            kind: "participant",
            parameters: { target: "unit" },
            evidence: { exact_text: "squad models" },
          }, {
            id: "reroll_effect",
            kind: "leaf",
            family_id: "reroll",
            parameters: { roll: "hit", subset: key === "all" ? "all" : key },
          }],
          relations: [{ id: "condition_controls_effect", type: "condition-of", from_node_id: "leading_condition", to_node_id: "reroll_effect" }, {
            id: "effect_targets_beneficiary",
            type: "targets",
            from_node_id: "reroll_effect",
            to_node_id: "beneficiary",
          }],
        });
        expect(draft.mechanics).toMatchObject({
          ability_id: fixture.abilities[key].abilityId,
          behavior: "passive",
          community_notes: `fixture-note-${fixture.abilities[key].abilityId}`,
          effect: {
            type: "conditional",
            condition: { type: "model-is-leader" },
            effect: { type: "re-roll", target: "unit", modifier: expectedModifiers[key] },
          },
          scope: { range: "unit", duration: "permanent" },
        });
        expect(draft.rendered_text).toEqual(expect.any(String));
      }

      const missingEntity = byAbility.get(fixture.abilities.missingEntity!.id)!;
      expect(missingEntity).toMatchObject({ status: "blocked", mechanics: null, diagnostic: { reason_code: "ENTITY_RESOLUTION" } });
      expect(missingEntity.graph).toMatchObject({ roots: ["reroll_effect"] });
      const dslGap = byAbility.get(fixture.abilities.dslGap!.id)!;
      expect(dslGap).toMatchObject({ status: "blocked", mechanics: null, diagnostic: { reason_code: "DSL_GAP" } });
      expect(() => draftVerificationSnapshot(fixture.db, String(dslGap.id))).toThrow(/blocked DSL gap/i);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM ability_reviews WHERE whole_context_checked=1").get()).toEqual({ count: 0 });
      expect(applyStamps(fixture.db)).toMatchObject({ changed: false, composition: { proposed: 0 } });
    } finally {
      fixture.db.close();
    }
  });

  it("retires surviving composition applications once no composition stamp remains approved", () => {
    const fixture = buildFixture();
    try {
      const live = fixture.db.prepare(`
        SELECT count(*) AS count FROM stamp_applications
        WHERE stamp_id = ? AND stamp_revision = ? AND status IN ('active', 'blocked')
      `).get(fixture.stampId, fixture.stampRevision) as { count: number };
      expect(live.count).toBeGreaterThan(0);
      // Leave the applications in place but remove their only approved stamp, so the
      // zero-composition path is the one that must clean them up.
      fixture.db.prepare("UPDATE stamps SET status = 'superseded' WHERE id = ? AND revision = ?").run(fixture.stampId, fixture.stampRevision);
      const report = applyStamps(fixture.db);
      expect(report.composition).toMatchObject({ proposed: 0, blocked: 0, stale: live.count, changed: true });
      expect(fixture.db.prepare("SELECT DISTINCT status, reason_code FROM stamp_applications WHERE stamp_id = ?").all(fixture.stampId))
        .toEqual([{ status: "stale", reason_code: "NO_LONGER_MATCHES" }]);
      expect(fixture.db.prepare("SELECT DISTINCT status FROM assembly_drafts").all()).toEqual([{ status: "stale" }]);
      expect(applyStamps(fixture.db).composition).toMatchObject({ stale: 0, changed: false });
    } finally {
      fixture.db.close();
    }
  });

  it("accepts only a current faithful-ok verifier snapshot and retains model disagreement", () => {
    const fixture = buildFixture();
    try {
      const drafts = listDrafts(fixture.db).items;
      const byAbility = new Map(drafts.map((draft) => [draft.ability_version_id, draft]));
      const allDraft = byAbility.get(fixture.abilities.all!.id)!;
      const failedDraft = byAbility.get(fixture.abilities.failed!.id)!;
      const onesDraft = byAbility.get(fixture.abilities.ones!.id)!;

      expect(allDraft.status).toBe("proposed");
      const allSnapshot = draftVerificationSnapshot(fixture.db, String(allDraft.id));
      const accepted = recordDraftVerification(fixture.db, {
        draft_id: String(allDraft.id),
        verifier_run_id: insertVerifierRun(fixture.db, String(allDraft.id), allSnapshot.evidence_hash, { faithful: true, severity: "ok", findings: [] }),
      }, () => "unused");
      expect(accepted.status).toBe("accepted");
      expect(getDraft(fixture.db, String(allDraft.id))).toMatchObject({ status: "accepted" });

      const failedSnapshot = draftVerificationSnapshot(fixture.db, String(failedDraft.id));
      const disagreed = recordDraftVerification(fixture.db, {
        draft_id: String(failedDraft.id),
        verifier_run_id: insertVerifierRun(fixture.db, String(failedDraft.id), failedSnapshot.evidence_hash, { faithful: true, severity: "minor", findings: [{ issue: "fixture qualifier" }] }),
      }, () => "fixture-escalation");
      expect(disagreed.status).toBe("blocked");
      expect(fixture.db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(fixture.stampId, fixture.stampRevision)).toEqual({ status: "approved" });
      expect(applyStamps(fixture.db)).toMatchObject({ changed: false });
      expect(getDraft(fixture.db, String(failedDraft.id))).toMatchObject({ status: "blocked", verifier_run_id: expect.any(Number) });

      const current = getDraft(fixture.db, String(onesDraft.id));
      const originalInputsHash = String(current.inputs_hash);
      const originalSchemaHash = String(current.schema_hash);
      const originalGraph = JSON.stringify(current.graph);
      const originalSourceHash = fixture.abilities.ones!.sourceHash;
      const stamp = fixture.db.prepare("SELECT definition_hash FROM stamps WHERE id=? AND revision=?")
        .get(fixture.stampId, fixture.stampRevision) as { definition_hash: string };

      fixture.db.prepare("UPDATE abilities SET source_hash=? WHERE id=?").run("a".repeat(64), fixture.abilities.ones!.id);
      expect(() => draftVerificationSnapshot(fixture.db, String(onesDraft.id))).toThrow(/source or rule dependency is stale/i);
      fixture.db.prepare("UPDATE abilities SET source_hash=? WHERE id=?").run(originalSourceHash, fixture.abilities.ones!.id);

      fixture.db.prepare("UPDATE stamps SET definition_hash=? WHERE id=? AND revision=?").run("b".repeat(64), fixture.stampId, fixture.stampRevision);
      expect(() => draftVerificationSnapshot(fixture.db, String(onesDraft.id))).toThrow(/source or rule dependency is stale/i);
      fixture.db.prepare("UPDATE stamps SET definition_hash=? WHERE id=? AND revision=?").run(stamp.definition_hash, fixture.stampId, fixture.stampRevision);

      fixture.db.prepare("UPDATE assembly_drafts SET schema_hash=? WHERE id=?").run("0".repeat(64), onesDraft.id);
      expect(() => draftVerificationSnapshot(fixture.db, String(onesDraft.id))).toThrow(/schema snapshot is stale/i);
      fixture.db.prepare("UPDATE assembly_drafts SET schema_hash=? WHERE id=?").run(originalSchemaHash, onesDraft.id);
      expect(originalSchemaHash).toBe(schemaTreeHash());

      writeFileSync(fixture.entitiesFile, JSON.stringify(fixture.entities.map((entity) =>
        entity.ability_id === fixture.abilities.ones!.abilityId ? { ...entity, name: "changed-fixture-name" } : entity)));
      expect(() => draftVerificationSnapshot(fixture.db, String(onesDraft.id))).toThrow(/entity dependency is stale/i);
      writeFileSync(fixture.entitiesFile, JSON.stringify(fixture.entities));

      const beforeDraftChange = draftVerificationSnapshot(fixture.db, String(onesDraft.id));
      const staleRun = insertVerifierRun(fixture.db, String(onesDraft.id), beforeDraftChange.evidence_hash, { faithful: true, severity: "ok", findings: [] });
      const changedGraph = { ...(current.graph as Record<string, unknown>), roots: ["leading_condition"] };
      fixture.db.prepare("UPDATE assembly_drafts SET graph_json=? WHERE id=?").run(JSON.stringify(changedGraph), onesDraft.id);
      expect(() => recordDraftVerification(fixture.db, { draft_id: String(onesDraft.id), verifier_run_id: staleRun }, () => "unused")).toThrow(/input snapshot is stale/i);
      fixture.db.prepare("UPDATE assembly_drafts SET graph_json=?, inputs_hash=? WHERE id=?").run(originalGraph, originalInputsHash, onesDraft.id);

      const currentSnapshot = draftVerificationSnapshot(fixture.db, String(onesDraft.id));
      const staleEvidenceRun = insertVerifierRun(fixture.db, String(onesDraft.id), "f".repeat(64), { faithful: true, severity: "ok", findings: [] });
      expect(() => recordDraftVerification(fixture.db, { draft_id: String(onesDraft.id), verifier_run_id: staleEvidenceRun }, () => "unused")).toThrow(/verifier evidence is stale/i);
      expect(currentSnapshot.evidence_hash).not.toBe("f".repeat(64));

      const onesSnapshot = draftVerificationSnapshot(fixture.db, String(onesDraft.id));
      expect(recordDraftVerification(fixture.db, {
        draft_id: String(onesDraft.id),
        verifier_run_id: insertVerifierRun(fixture.db, String(onesDraft.id), onesSnapshot.evidence_hash, { faithful: true, severity: "ok", findings: [] }),
      }, () => "unused")).toMatchObject({ status: "accepted" });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM ability_reviews WHERE whole_context_checked=1").get()).toEqual({ count: 0 });
    } finally {
      fixture.db.close();
    }
  });

  it.each(["bind", "case"] as const)("blocks mechanics templates that %s through a source-qualified leaf value", (mode) => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const source = "Set the bearer's M characteristic to D6.";
      const ability = addAbility(db, `source-qualified-${mode}`, source);
      const exactText = source.slice(0, -1);
      applyAnnotationBatch(db, {
        reviewer: "fixture-reviewer",
        decisions: [{
          action: "confirm",
          ability_version_id: ability.id,
          source_hash: ability.sourceHash,
          fragment: "RAW_TEXT",
          start_byte: 0,
          end_byte: Buffer.byteLength(exactText, "utf8"),
          exact_text: exactText,
          role: "EFFECT",
          family_id: "characteristic-set",
          family_version: 1,
          parameters: { subject: "bearer", characteristic: "M", value: { source: "D6" } },
        }],
      });
      const sourceValue = mode === "bind"
        ? { $bind: "source_leaf.parameters.value.source" }
        : {
          $case: "source_leaf.parameters.value.source",
          cases: [{ value: "D6", then: "passive" }],
        };
      const definition = {
        schema_version: 1 as const,
        kind: "composition" as const,
        label: `Source-qualified ${mode} traversal`,
        variants: [{
          id: "complete",
          source_types: ["unit"],
          fragments: [{ fragment: "RAW_TEXT", segments: [
            { id: "source_leaf", leaf: { family_id: "characteristic-set", family_version: 1 } },
            { id: "terminator", literal: "." },
          ] }],
          slots: {},
          graph_template: {
            schema_version: 1,
            nodes: [{
              id: "characteristic_effect",
              kind: "leaf",
              family_id: "characteristic-set",
              family_version: 1,
              parameters: {
                subject: { $bind: "source_leaf.parameters.subject" },
                characteristic: { $bind: "source_leaf.parameters.characteristic" },
                value: { $bind: "source_leaf.parameters.value" },
              },
              evidence: { fragment: "RAW_TEXT", first_segment_id: "source_leaf", last_segment_id: "source_leaf" },
            }],
            relations: [],
            roots: ["characteristic_effect"],
          },
          mechanics_template: {
            effect: {
              type: "stat-modifier",
              target: "self",
              modifier: { stat: "M", operation: "set", value: 6 },
            },
            scope: { range: "self", duration: "permanent" },
            behavior: sourceValue,
            trigger: null,
            usage: null,
            applies_to: null,
          },
        }],
      };
      const stamp = proposeStamp(db, {
        definition,
        positives: [sourceReference(ability)],
        counterexamples: [],
      });
      attachClearChallenge(db, stamp.stamp_id, stamp.revision);
      approveStamp(db, stamp.stamp_id, stamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, stamp.stamp_id, stamp.revision).preview_hash,
      });
      const draft = listDrafts(db).items[0]!;
      expect(draft).toMatchObject({
        status: "blocked",
        diagnostic: {
          reason_code: "DSL_GAP",
          message: expect.stringMatching(/source-qualified semantic value cannot be traversed/i),
        },
      });
    } finally {
      db.close();
    }
  });

  it("keeps draft pagination on its original snapshot when a newer draft is inserted", () => {
    const fixture = buildFixture();
    try {
      const abilityVersionId = fixture.abilities.all!.id;
      const insertDraft = (index: number, createdAt: string): void => {
        const applicationId = `pagination-application-${index}`;
        fixture.db.prepare(`
          INSERT INTO stamp_applications (
            id, stamp_id, stamp_revision, ability_version_id, variant_id,
            inputs_hash, bindings_json, dependencies_json, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'pagination', ?, '{}', '{}', 'active', ?, ?)
        `).run(applicationId, fixture.stampId, fixture.stampRevision, abilityVersionId, hashJson({ index }), createdAt, createdAt);
        fixture.db.prepare(`
          INSERT INTO assembly_drafts (
            id, composition_application_id, graph_json, mechanics_json,
            rendered_text, inputs_hash, schema_hash, status,
            diagnostic_json, created_at, updated_at
          ) VALUES (?, ?, '{}', NULL, NULL, ?, ?, 'proposed', '{}', ?, ?)
        `).run(`pagination-draft-${index}`, applicationId, hashJson({ index, draft: true }), schemaTreeHash(), createdAt, createdAt);
      };
      for (let index = 0; index < 21; index += 1) {
        insertDraft(index, `2026-02-01T00:${String(index).padStart(2, "0")}:00.000Z`);
      }
      const snapshotIds = (fixture.db.prepare(`
        SELECT id FROM assembly_drafts ORDER BY created_at DESC, id
      `).all() as Array<{ id: string }>).map((row) => row.id);
      const first = listDrafts(fixture.db);
      expect(first.next_cursor).not.toBeNull();
      insertDraft(99, "9999-01-01T00:00:00.000Z");
      const second = listDrafts(fixture.db, { cursor: first.next_cursor! });
      expect([...first.items, ...second.items].map((item) => item.id)).toEqual(snapshotIds);
      expect(second.total).toBe(snapshotIds.length);
    } finally {
      fixture.db.close();
    }
  });
});

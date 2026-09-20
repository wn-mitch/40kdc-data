import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { applyAnnotationBatch, getDashboard, getPrivateExport } from "../src/round5c/review.js";
import { approveStamp, getStampAudit, previewStamp, proposeStamp, recordStampAudit, type StampAuditItem } from "../src/round5c/stamps.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

type AbilityFixture = { id: number; abilityId: string; source: string; sourceHash: string };

function addAbility(db: DatabaseSync, abilityId: string, source: string): AbilityFixture {
  const sourceHash = hashJson({ text: source });
  const inserted = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(
    abilityId,
    sourceHash,
    source,
    abilityId,
    JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]),
  );
  return { id: Number(inserted.lastInsertRowid), abilityId, source, sourceHash };
}

function reference(ability: AbilityFixture, exactText: string) {
  const characterStart = ability.source.indexOf(exactText);
  if (characterStart < 0) throw new Error(`Fixture source does not contain ${exactText}.`);
  const startByte = Buffer.byteLength(ability.source.slice(0, characterStart), "utf8");
  return {
    ability_version_id: ability.id,
    source_hash: ability.sourceHash,
    fragment: "RAW_TEXT",
    start_byte: startByte,
    end_byte: startByte + Buffer.byteLength(exactText, "utf8"),
    exact_text: exactText,
  };
}

function attachClearChallenge(db: DatabaseSync, stampId: string, revision: number): void {
  const stamp = db.prepare("SELECT definition_hash FROM stamps WHERE id=? AND revision=?")
    .get(stampId, revision) as { definition_hash: string };
  const run = db.prepare(`
    INSERT INTO model_runs (
      model, model_version, prompt_version, input_hash, config_json, output_json, status, created_at
    ) VALUES ('fixture-model', 'fixture-version', 'fixture-prompt', ?, '{}', ?, 'completed', '2026-01-01T00:00:00.000Z')
  `).run("c".repeat(64), JSON.stringify({ definition_hash: stamp.definition_hash, verdict: "clear" }));
  db.prepare("UPDATE stamps SET challenge_run_id=? WHERE id=? AND revision=?")
    .run(Number(run.lastInsertRowid), stampId, revision);
}

function literalDefinition() {
  return {
    schema_version: 1 as const,
    kind: "leaf" as const,
    label: "Complete Hit reroll",
    variants: [{
      id: "literal",
      source_types: "any" as const,
      fragments: [{ fragment: "RAW_TEXT", segments: [{ id: "form", literal: "Re-roll the Hit roll" }] }],
      slots: {},
      before: [{ boundary: "fragment" as const }, { boundary: "word" as const }],
      after: [{ literal: "." }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "all" } },
      allow_containment: [],
    }],
  };
}

function confirmSeed(db: DatabaseSync, ability: AbilityFixture): void {
  applyAnnotationBatch(db, {
    reviewer: "fixture-reviewer",
    decisions: [{
      action: "confirm",
      ...reference(ability, "Re-roll the Hit roll"),
      role: "EFFECT",
      family_id: "reroll",
      family_version: 1,
      parameters: { roll: "hit", subset: "all" },
    }],
  });
}

function approveLiteral(db: DatabaseSync, abilities: AbilityFixture[]) {
  confirmSeed(db, abilities[0]!);
  const proposed = proposeStamp(db, {
    definition: literalDefinition(),
    positives: [reference(abilities[0]!, "Re-roll the Hit roll")],
    counterexamples: [],
  });
  approveStamp(db, proposed.stamp_id, proposed.revision, {
    reviewer: "fixture-reviewer",
    preview_hash: previewStamp(db, proposed.stamp_id, proposed.revision).preview_hash,
  });
  return proposed;
}

function auditItemFor(db: DatabaseSync, stampId: string, revision: number, abilityId: string) {
  const first = getStampAudit(db, stampId, revision);
  const pages = [first];
  let cursor = first.next_cursor;
  while (cursor) {
    const page = getStampAudit(db, stampId, revision, { cursor });
    pages.push(page);
    cursor = page.next_cursor;
  }
  const item = pages.flatMap((page) => page.items).find((candidate) => candidate.ability_id === abilityId);
  if (!item) throw new Error(`Audit sample omitted fixture ability ${abilityId}.`);
  return item as StampAuditItem;
}

describe("Round 5C optional stamp audits", () => {
  it("reports unknown ratios as null when there is no current denominator", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      expect(getDashboard(db)).toMatchObject({
        total_source_records: 0,
        coverage: {
          average_leaf_fraction: null,
          average_human_leaf_fraction: null,
          average_stamp_leaf_fraction: null,
        },
        accepted_complete_drafts_per_human_decision: null,
        human_actions_per_confirmed_occurrence: null,
        confirmations_per_batch: null,
      });
    } finally {
      db.close();
    }
  });

  it("builds a reproducible paginated pool across variant, enum, numeric, and neighboring-context strata", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const rerolls = Array.from({ length: 23 }, (_, index) => addAbility(
        db,
        `reroll-${index}`,
        `Opening context ${index}. Re-roll ${index % 2 === 0 ? "Hit" : "Wound"} rolls. Closing context ${index}.`,
      ));
      const modifiers = [-2, 0, 2].map((amount) => addAbility(
        db,
        `modifier-${amount}`,
        `Modifier context ${amount}. Add ${amount} to Hit rolls. Modifier tail ${amount}.`,
      ));
      const definition = {
        schema_version: 1 as const,
        kind: "leaf" as const,
        label: "Auditable typed forms",
        variants: [{
          id: "reroll",
          source_types: "any" as const,
          fragments: [{ fragment: "RAW_TEXT", segments: [
            { id: "prefix", literal: "Re-roll " },
            { id: "roll_form", slot: "roll" },
            { id: "suffix", literal: " rolls" },
          ] }],
          slots: { roll: { kind: "enum" as const, values: [{ text: "Hit", value: "hit" }, { text: "Wound", value: "wound" }] } },
          before: [{ boundary: "word" as const }],
          after: [{ literal: "." }],
          output: { family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "roll" }, subset: "all" } },
          allow_containment: [],
        }, {
          id: "modifier",
          source_types: "any" as const,
          fragments: [{ fragment: "RAW_TEXT", segments: [
            { id: "prefix", literal: "Add " },
            { id: "amount_form", slot: "amount" },
            { id: "suffix", literal: " to Hit rolls" },
          ] }],
          slots: { amount: { kind: "integer" as const, min: -2, max: 2 } },
          before: [{ boundary: "word" as const }],
          after: [{ literal: "." }],
          output: { family_id: "roll-modifier", family_version: 1, parameters: { roll: "hit", operation: "add", value: { $bind: "amount" } } },
          allow_containment: [],
        }],
      };
      const proposed = proposeStamp(db, {
        definition,
        positives: [
          reference(rerolls[0]!, "Re-roll Hit rolls"),
          reference(modifiers[0]!, "Add -2 to Hit rolls"),
        ],
        counterexamples: [],
      });
      attachClearChallenge(db, proposed.stamp_id, proposed.revision);
      approveStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, proposed.stamp_id, proposed.revision).preview_hash,
      });

      const first = getStampAudit(db, proposed.stamp_id, proposed.revision);
      const repeated = getStampAudit(db, proposed.stamp_id, proposed.revision);
      expect(repeated).toEqual(first);
      expect(first.items).toHaveLength(20);
      expect(first.next_cursor).not.toBeNull();
      expect(first.coverage).toMatchObject({
        applications: 26,
        selected: 26,
        variants: { observed: 2, represented: 2 },
        enum_combinations: { observed: 2, represented: 2 },
        numeric_extrema: { observed: 2, represented: 2 },
        neighboring_contexts: { observed: 26, represented: 26 },
      });
      const second = getStampAudit(db, proposed.stamp_id, proposed.revision, { cursor: first.next_cursor! });
      expect(second.audit_hash).toBe(first.audit_hash);
      expect(second.items).toHaveLength(6);
      expect(new Set([...first.items, ...second.items].map((item) => item.application_id)).size).toBe(26);
      expect(first.items.every((item) => typeof item.dependency_hash === "string" && item.strata.length > 0)).toBe(true);
      expect(() => getStampAudit(db, proposed.stamp_id, proposed.revision, { cursor: "not-a-cursor" })).toThrow(/cursor is malformed/i);
      db.prepare("UPDATE stamp_applications SET inputs_hash=? WHERE id=?")
        .run("e".repeat(64), second.items[0]!.application_id);
      expect(() => getStampAudit(db, proposed.stamp_id, proposed.revision, { cursor: first.next_cursor! })).toThrow(/evidence changed/i);
    } finally {
      db.close();
    }
  });

  it("records evidence-pinned audits, separates occurrence correction from rule suspension, and counts human effort honestly", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const abilities = [
        addAbility(db, "seed", "Re-roll the Hit roll."),
        addAbility(db, "correct", "Opening. Re-roll the Hit roll. Closing."),
        addAbility(db, "uncertain", "First. Re-roll the Hit roll. Last."),
        addAbility(db, "occurrence-defect", "Before. Re-roll the Hit roll. After."),
        addAbility(db, "rule-defect", "Prefix. Re-roll the Hit roll. Suffix."),
      ];
      const stamp = approveLiteral(db, abilities);

      const correctItem = auditItemFor(db, stamp.stamp_id, stamp.revision, "correct");
      recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: correctItem.application_id,
        reviewer: "fixture-reviewer",
        source_hash: correctItem.source_hash,
        dependency_hash: correctItem.dependency_hash,
        verdict: "correct",
      });
      expect(getDashboard(db)).toMatchObject({
        confirmed_occurrences: 1,
        derived_occurrences: 4,
        human_decisions: 3,
        audits: { correct: 1 },
      });

      const uncertainItem = auditItemFor(db, stamp.stamp_id, stamp.revision, "uncertain");
      recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: uncertainItem.application_id,
        reviewer: "fixture-reviewer",
        source_hash: uncertainItem.source_hash,
        dependency_hash: uncertainItem.dependency_hash,
        verdict: "uncertain",
      });
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(stamp.stamp_id, stamp.revision)).toEqual({ status: "approved" });
      expect(getDashboard(db).escalations).toMatchObject({ open: { groups: 1, occurrences: 1 } });

      const occurrenceItem = auditItemFor(db, stamp.stamp_id, stamp.revision, "occurrence-defect");
      expect(() => recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: occurrenceItem.application_id,
        reviewer: "fixture-reviewer",
        source_hash: occurrenceItem.source_hash,
        dependency_hash: "0".repeat(64),
        verdict: "incorrect",
        scope: "occurrence",
      })).toThrow(/evidence changed/i);
      const occurrenceResult = recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: occurrenceItem.application_id,
        reviewer: "fixture-reviewer",
        source_hash: occurrenceItem.source_hash,
        dependency_hash: occurrenceItem.dependency_hash,
        verdict: "incorrect",
        scope: "occurrence",
      });
      expect(occurrenceResult.correction).toMatchObject({ ability_version_id: abilities[3]!.id, exact_text: "Re-roll the Hit roll" });
      expect(db.prepare("SELECT status, reason_code FROM stamp_applications WHERE id=?").get(occurrenceItem.application_id)).toEqual({ status: "blocked", reason_code: "AUDIT_OCCURRENCE_INCORRECT" });
      expect(getAbilityCoverage(db, abilities[3]!.id)).toMatchObject({ leaf_fraction: 0, stamp_leaf_fraction: 0 });
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(stamp.stamp_id, stamp.revision)).toEqual({ status: "approved" });

      const ruleItem = auditItemFor(db, stamp.stamp_id, stamp.revision, "rule-defect");
      db.prepare(`
        INSERT INTO assembly_drafts (
          id, composition_application_id, graph_json, mechanics_json, rendered_text,
          inputs_hash, schema_hash, status, verifier_run_id, diagnostic_json, created_at, updated_at
        ) VALUES ('published-draft', ?, '{}', NULL, NULL, ?, ?, 'accepted', NULL, '{}', ?, ?)
      `).run(ruleItem.application_id, "d".repeat(64), "s".repeat(64), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      db.prepare(`
        INSERT INTO publication_batches (
          id, preview_hash, faction_id, state, manifest_json, created_at, updated_at
        ) VALUES ('published-batch', ?, 'fixture', 'published', ?, ?, ?)
      `).run("p".repeat(64), JSON.stringify({ draft_ids: ["published-draft"] }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      expect(getDashboard(db)).toMatchObject({
        accepted_complete_drafts: 1,
        accepted_complete_drafts_per_human_decision: 0.2,
      });
      const ruleResult = recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: ruleItem.application_id,
        reviewer: "fixture-reviewer",
        source_hash: ruleItem.source_hash,
        dependency_hash: ruleItem.dependency_hash,
        verdict: "incorrect",
        scope: "rule",
      });
      expect(ruleResult.affected_published_entries).toEqual([{
        publication_batch_id: "published-batch",
        faction_id: "fixture",
        ability_id: "rule-defect",
        draft_id: "published-draft",
      }]);
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(stamp.stamp_id, stamp.revision)).toEqual({ status: "suspended" });
      expect(getDashboard(db)).toMatchObject({
        confirmed_occurrences: 1,
        derived_occurrences: 0,
        human_decisions: 6,
        audits: { correct: 0, incorrect: 0, uncertain: 0 },
        audit_actions: { correct: 1, incorrect: 2, uncertain: 1 },
      });
      expect(db.prepare("SELECT count(*) AS count FROM stamp_audit_decisions").get()).toEqual({ count: 4 });
      expect(db.prepare("SELECT count(*) AS count FROM annotation_batches WHERE operation='stamp-application'").get()).toEqual({ count: 2 });

      const exported = getPrivateExport(db);
      expect(exported).toMatchObject({ schema_version: 1, kind: "round5c-private-current-state" });
      expect(exported.annotations).toEqual([
        expect.objectContaining({ authority_kind: "human", human_confirmed_by: "fixture-reviewer", rule_authorized_by: null }),
      ]);
      expect(exported.audits).toEqual(expect.arrayContaining([
        expect.objectContaining({ verdict: "correct", source_hash: correctItem.source_hash, dependency_hash: correctItem.dependency_hash }),
        expect.objectContaining({ verdict: "incorrect", scope: "rule" }),
      ]));
      expect(exported.applications).toEqual(expect.arrayContaining([
        expect.objectContaining({ dependencies: expect.objectContaining({ matcher_version: "round5c/stamp-matcher/v1" }) }),
      ]));
      expect(exported.decision_batches).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: "stamp-audit", members: [expect.objectContaining({ entity_kind: "stamp-audit-decision" })] }),
      ]));
    } finally {
      db.close();
    }
  });
  it("reports only the latest verdict for current effective authority while retaining every audit action", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const abilities = [
        addAbility(db, "seed", "Re-roll the Hit roll."),
        addAbility(db, "target", "Re-roll the Hit roll."),
      ];
      const stamp = approveLiteral(db, abilities);
      const target = auditItemFor(db, stamp.stamp_id, stamp.revision, "target");
      recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: target.application_id,
        reviewer: "fixture-reviewer",
        source_hash: target.source_hash,
        dependency_hash: target.dependency_hash,
        verdict: "correct",
      });
      recordStampAudit(db, {
        stamp_id: stamp.stamp_id,
        revision: stamp.revision,
        application_id: target.application_id,
        reviewer: "fixture-reviewer",
        source_hash: target.source_hash,
        dependency_hash: target.dependency_hash,
        verdict: "uncertain",
      });
      expect(getDashboard(db)).toMatchObject({
        audits: { correct: 0, incorrect: 0, uncertain: 1 },
        audit_actions: { correct: 1, incorrect: 0, uncertain: 1 },
      });
      expect(db.prepare("SELECT count(*) AS count FROM stamp_audit_decisions").get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  it("excludes an incorrect local interpretation from every equivalent stamp support", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const abilities = [
        addAbility(db, "seed", "Re-roll the Hit roll."),
        addAbility(db, "target", "Re-roll the Hit roll."),
      ];
      const first = approveLiteral(db, abilities);
      const secondDefinition = { ...literalDefinition(), label: "Independent complete Hit reroll" };
      const second = proposeStamp(db, {
        definition: secondDefinition,
        positives: [reference(abilities[0]!, "Re-roll the Hit roll")],
        counterexamples: [],
      });
      approveStamp(db, second.stamp_id, second.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, second.stamp_id, second.revision).preview_hash,
      });
      expect(db.prepare(`
        SELECT count(*) AS count FROM stamp_applications
        WHERE ability_version_id=? AND status='active'
      `).get(abilities[1]!.id)).toEqual({ count: 2 });

      const target = auditItemFor(db, first.stamp_id, first.revision, "target");
      recordStampAudit(db, {
        stamp_id: first.stamp_id,
        revision: first.revision,
        application_id: target.application_id,
        reviewer: "fixture-reviewer",
        source_hash: target.source_hash,
        dependency_hash: target.dependency_hash,
        verdict: "incorrect",
        scope: "occurrence",
      });
      expect(db.prepare(`
        SELECT count(*) AS count FROM stamp_applications
        WHERE ability_version_id=? AND status='blocked'
          AND reason_code='AUDIT_OCCURRENCE_INCORRECT'
      `).get(abilities[1]!.id)).toEqual({ count: 2 });
      expect(getAbilityCoverage(db, abilities[1]!.id)).toMatchObject({
        leaf_fraction: 0,
        stamp_leaf_fraction: 0,
      });
      expect(db.prepare("SELECT count(*) AS count FROM stamps WHERE status='approved'").get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });


  it("never counts an active derived row whose application authority is stale", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const abilities = [
        addAbility(db, "seed", "Re-roll the Hit roll."),
        addAbility(db, "target", "Re-roll the Hit roll."),
      ];
      const stamp = approveLiteral(db, abilities);
      const targetItem = auditItemFor(db, stamp.stamp_id, stamp.revision, "target");
      expect(getAbilityCoverage(db, abilities[1]!.id).stamp_leaf_fraction).toBe(1);
      const modelRun = Number(db.prepare(`
        INSERT INTO model_runs (
          model, model_version, prompt_version, input_hash, config_json,
          output_json, status, created_at
        ) VALUES ('fixture-model', 'fixture-version', 'fixture-prompt', ?, '{}', NULL, 'pending', ?)
      `).run("m".repeat(64), "2026-01-01T00:00:00.000Z").lastInsertRowid);
      const derived = db.prepare(`
        SELECT annotations.span_id, annotations.fingerprint_id
        FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp'
      `).get(abilities[1]!.id) as { span_id: number; fingerprint_id: string };
      db.prepare(`
        INSERT INTO proposals (
          span_id, fingerprint_id, role, origin, model_run_id,
          status, reason_json, score, created_at
        ) VALUES (?, ?, 'EFFECT', 'luna', ?, 'pending', '{}', NULL, ?)
      `).run(derived.span_id, derived.fingerprint_id, modelRun, "2026-01-01T00:00:00.000Z");
      expect(getDashboard(db)).toMatchObject({
        model_proposal_occurrences: 1,
        model_proposals: { pending: 1 },
      });
      db.prepare("UPDATE stamp_applications SET status='stale', reason_code='FIXTURE_STALE' WHERE id=?").run(targetItem.application_id);
      expect(db.prepare(`
        SELECT annotations.status FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp'
      `).get(abilities[1]!.id)).toEqual({ status: "active" });
      expect(getAbilityCoverage(db, abilities[1]!.id)).toMatchObject({ leaf_fraction: 0, stamp_leaf_fraction: 0 });
      expect(getDashboard(db).derived_occurrences).toBe(0);
      expect((getPrivateExport(db).annotations as Array<{ ability_id: string }>).some((annotation) => annotation.ability_id === "target")).toBe(false);
    } finally {
      db.close();
    }
  });
});

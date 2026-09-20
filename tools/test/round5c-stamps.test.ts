import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { validateFingerprint } from "../src/round5c/contracts.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { getWorkbenchRevision, initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { createFragmentScan, matchFragmentPattern, validateStampDefinition } from "../src/round5c/matching.js";
import { referenceMatchFragmentPattern } from "./fixtures/round5c-matcher-reference.js";
import { applyAnnotationBatch, getPrivateExport, undoBatch } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";
import { applyStamps, approveStamp, listStamps, previewStamp, proposeStamp, rejectStamp, stampApprovalEligibility, suspendStamp } from "../src/round5c/stamps.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type AbilityFixture = {
  id: number;
  source: string;
  sourceHash: string;
};

function addAbility(db: DatabaseSync, abilityId: string, source: string, sourceType = "unit"): AbilityFixture {
  const sourceHash = hashJson({ text: source });
  const inserted = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', ?, ?, ?, ?, 'fixture', ?, '{}', ?, 1)
  `).run(
    abilityId,
    sourceHash,
    source,
    sourceType,
    abilityId,
    JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]),
  );
  return { id: Number(inserted.lastInsertRowid), source, sourceHash };
}

function rerollAllDefinition(subset: "all" | "ones" = "all", label = "Complete Hit reroll") {
  return {
    schema_version: 1 as const,
    kind: "leaf" as const,
    label,
    variants: [{
      id: "literal",
      source_types: "any" as const,
      fragments: [{ fragment: "RAW_TEXT", segments: [{ id: "form", literal: "Re-roll the Hit roll" }] }],
      slots: {},
      before: [{ boundary: "fragment" as const }, { boundary: "word" as const }],
      after: [{ literal: "." }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset } },
      allow_containment: [],
    }],
  };
}

function reference(ability: AbilityFixture, exactText = "Re-roll the Hit roll") {
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


function confirmReroll(db: DatabaseSync, ability: AbilityFixture, subset: "all" | "ones") {
  return applyAnnotationBatch(db, {
    reviewer: "fixture-reviewer",
    decisions: [{
      action: "confirm",
      ...reference(ability),
      role: "EFFECT",
      family_id: "reroll",
      family_version: 1,
      parameters: { roll: "hit", subset },
    }],
  });
}

function typedRerollDefinition() {
  const roll = { kind: "enum" as const, values: [{ text: "Hit", value: "hit" }, { text: "Wound", value: "wound" }] };
  return {
    schema_version: 1 as const,
    kind: "leaf" as const,
    label: "Typed rerolls",
    variants: [{
      id: "all",
      source_types: ["unit"],
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "prefix", literal: "Re-roll the " },
        { id: "roll_form", slot: "roll" },
        { id: "suffix", literal: " roll" },
      ] }],
      slots: { roll },
      before: [{ boundary: "fragment" as const }],
      after: [{ literal: "." }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "roll" }, subset: "all" } },
      allow_containment: [],
    }, {
      id: "ones",
      source_types: ["unit"],
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "prefix", literal: "Re-roll " },
        { id: "roll_form", slot: "roll" },
        { id: "suffix", literal: " rolls of 1" },
      ] }],
      slots: { roll },
      before: [{ boundary: "fragment" as const }],
      after: [{ literal: "." }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "roll" }, subset: "ones" } },
      allow_containment: [],
    }],
  };
}

function attachClearChallenge(
  db: DatabaseSync,
  stampId: string,
  stampRevision: number,
  verdict: "clear" | "objection" = "clear",
): void {
  const stamp = db.prepare("SELECT definition_hash FROM stamps WHERE id=? AND revision=?")
    .get(stampId, stampRevision) as { definition_hash: string };
  const run = db.prepare(`
    INSERT INTO model_runs (
      model, model_version, prompt_version, input_hash, config_json, output_json, status, created_at
    ) VALUES ('fixture-model', 'fixture-version', 'fixture-prompt', ?, '{}', ?, 'completed', '2026-01-01T00:00:00.000Z')
  `).run("c".repeat(64), JSON.stringify({ definition_hash: stamp.definition_hash, verdict }));
  db.prepare("UPDATE stamps SET challenge_run_id=? WHERE id=? AND revision=?")
    .run(Number(run.lastInsertRowid), stampId, stampRevision);
}

function sourceStore(records: unknown[]): { directory: string; file: string } {
  const directory = mkdtempSync(join(tmpdir(), "round5c-stamps-"));
  directories.push(directory);
  const file = join(directory, "fixture.json");
  writeFileSync(file, JSON.stringify(records));
  return { directory, file };
}
describe("Round 5C stamp matching and authority", () => {
  it("keeps terminal guards, typed alternatives, integer tokens, and UTF-8 offsets exact", () => {
    const definition = validateStampDefinition({
      schema_version: 1,
      kind: "leaf",
      label: "Typed rerolls",
      variants: [{
        id: "all",
        source_types: "any",
        fragments: [{ fragment: "RAW_TEXT", segments: [
          { id: "prefix", literal: "Re-roll the " },
          { id: "roll_form", slot: "roll" },
          { id: "suffix", literal: " roll" },
        ] }],
        slots: { roll: { kind: "enum", values: [{ text: "Hit", value: "hit" }, { text: "Wound", value: "wound" }] } },
        before: [{ boundary: "fragment" }],
        after: [{ boundary: "fragment" }],
        output: { family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "roll" }, subset: "all" } },
        allow_containment: [],
      }, {
        id: "ones",
        source_types: "any",
        fragments: [{ fragment: "RAW_TEXT", segments: [
          { id: "prefix", literal: "Re-roll " },
          { id: "roll_form", slot: "roll" },
          { id: "suffix", literal: " rolls of 1" },
        ] }],
        slots: { roll: { kind: "enum", values: [{ text: "Hit", value: "hit" }, { text: "Wound", value: "wound" }] } },
        before: [{ boundary: "fragment" }],
        after: [{ boundary: "fragment" }],
        output: { family_id: "reroll", family_version: 1, parameters: { roll: { $bind: "roll" }, subset: "ones" } },
        allow_containment: [],
      }],
    });
    expect(definition.kind).toBe("leaf");
    if (definition.kind !== "leaf") throw new Error("fixture definition changed kind");
    const forms = ["Re-roll the Hit roll", "Re-roll the Wound roll", "Re-roll Hit rolls of 1", "Re-roll Wound rolls of 1"];
    const combinations = forms.flatMap((text) => definition.variants.flatMap((variant) => matchFragmentPattern(
      variant.fragments[0],
      variant.slots,
      { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(text, "utf8"), text },
      { complete: false, before: variant.before, after: variant.after },
    ).map((match) => ({ variant: variant.id, ...match.bindings }))));
    expect(combinations).toEqual([
      { variant: "all", roll: "hit" },
      { variant: "all", roll: "wound" },
      { variant: "ones", roll: "hit" },
      { variant: "ones", roll: "wound" },
    ]);
    const repeatedPattern = {
      fragment: "RAW_TEXT",
      segments: [
        { id: "first_roll", slot: "roll" },
        { id: "joiner", literal: " then " },
        { id: "second_roll", slot: "roll" },
      ],
    };
    expect(matchFragmentPattern(
      repeatedPattern,
      definition.variants[0]!.slots,
      { fragment: "RAW_TEXT", start_byte: 0, end_byte: 12, text: "Hit then Hit" },
      { complete: true },
    )).toHaveLength(1);
    expect(matchFragmentPattern(
      repeatedPattern,
      definition.variants[0]!.slots,
      { fragment: "RAW_TEXT", start_byte: 0, end_byte: 14, text: "Hit then Wound" },
      { complete: true },
    )).toEqual([]);
    const longer = "Re-roll the Hit roll of 1";
    expect(matchFragmentPattern(
      definition.variants[0]!.fragments[0],
      definition.variants[0]!.slots,
      { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(longer, "utf8"), text: longer },
      { complete: false, before: definition.variants[0]!.before, after: definition.variants[0]!.after },
    )).toEqual([]);

    const integerDefinition = validateStampDefinition({
      schema_version: 1,
      kind: "leaf",
      label: "Integer modifier",
      variants: [{
        id: "modifier",
        source_types: "any",
        fragments: [{ fragment: "RAW_TEXT", segments: [
          { id: "prefix", literal: "Add " },
          { id: "amount_form", slot: "amount" },
          { id: "suffix", literal: " to café—Hit rolls." },
        ] }],
        slots: { amount: { kind: "integer", min: -2, max: 2 } },
        before: [{ boundary: "fragment" }],
        after: [{ boundary: "fragment" }],
        output: { family_id: "roll-modifier", family_version: 1, parameters: { roll: "hit", operation: "add", value: { $bind: "amount" } } },
        allow_containment: [],
      }],
    });
    if (integerDefinition.kind !== "leaf") throw new Error("fixture definition changed kind");
    const integerVariant = integerDefinition.variants[0]!;
    const utf8Text = "Add +2 to cafe\u0301–Hit rolls.";
    const integerMatches = matchFragmentPattern(
      integerVariant.fragments[0],
      integerVariant.slots,
      { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(utf8Text, "utf8"), text: utf8Text },
      { complete: false, before: integerVariant.before, after: integerVariant.after },
    );
    expect(integerMatches).toHaveLength(1);
    expect(integerMatches[0]).toMatchObject({ start_byte: 0, end_byte: Buffer.byteLength(utf8Text, "utf8"), exact_text: utf8Text, bindings: { amount: 2 } });
    for (const text of ["Add 10 to café—Hit rolls.", "Add 2.0 to café—Hit rolls.", "Add 2e0 to café—Hit rolls."]) {
      expect(matchFragmentPattern(
        integerVariant.fragments[0],
        integerVariant.slots,
        { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(text, "utf8"), text },
        { complete: false, before: integerVariant.before, after: integerVariant.after },
      )).toEqual([]);
    }
  });

  it("approves one paginated literal preview, propagates corpus-wide, and preserves shared support", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const abilities = Array.from({ length: 61 }, (_, index) => addAbility(
        db,
        `ability-${index}`,
        index === 0 ? "Re-roll the Hit roll." : `Opening effect ${index}. Re-roll the Hit roll. Closing effect ${index}.`,
      ));
      const seed = abilities[0]!;
      const seedReference = reference(seed);
      applyAnnotationBatch(db, {
        reviewer: "fixture-reviewer",
        decisions: [{
          action: "confirm",
          ...seedReference,
          role: "EFFECT",
          family_id: "reroll",
          family_version: 1,
          parameters: { roll: "hit", subset: "all" },
        }],
      });

      const pendingReference = reference(abilities[1]!);
      const pendingSpan = insertSpan(
        db,
        pendingReference.ability_version_id,
        pendingReference.fragment,
        pendingReference.start_byte,
        pendingReference.end_byte,
        pendingReference.exact_text,
      );
      const pendingFingerprint = validateFingerprint(db, "reroll", { roll: "hit", subset: "all" }, 1, pendingReference.exact_text);
      const pendingProposal = Number(db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
        VALUES (?, ?, 'EFFECT', 'fixture', 'pending', '{}', NULL, '2026-01-01T00:00:00.000Z')
      `).run(pendingSpan, pendingFingerprint).lastInsertRowid);

      const first = proposeStamp(db, { definition: rerollAllDefinition(), positives: [seedReference], counterexamples: [] });
      const preview = previewStamp(db, first.stamp_id, first.revision);
      expect(preview.totals).toEqual({ eligible: 60, already_satisfied: 1, blocked: 0 });
      expect(preview.examples).toHaveLength(20);
      expect(preview.next_cursor).not.toBeNull();
      const secondPage = previewStamp(db, first.stamp_id, first.revision, { cursor: preview.next_cursor! });
      expect(secondPage.preview_hash).toBe(preview.preview_hash);
      expect(secondPage.totals).toEqual(preview.totals);
      expect(secondPage.examples).toHaveLength(20);
      const approval = approveStamp(db, first.stamp_id, first.revision, { reviewer: "fixture-reviewer", preview_hash: preview.preview_hash });
      expect(approval).toMatchObject({ applied: 60, already_satisfied: 1, blocked: 0 });
      expect(previewStamp(db, first.stamp_id, first.revision).totals).toEqual({ eligible: 0, already_satisfied: 61, blocked: 0 });
      expect(db.prepare("SELECT status FROM proposals WHERE id=?").get(pendingProposal)).toEqual({ status: "superseded" });
      expect(db.prepare("SELECT authority_kind, count(*) AS count FROM annotations WHERE status='active' GROUP BY authority_kind ORDER BY authority_kind").all()).toEqual([
        { authority_kind: "human", count: 1 },
        { authority_kind: "stamp", count: 60 },
      ]);
      expect(getAbilityCoverage(db, seed.id)).toMatchObject({
        leaf_fraction: 1,
        human_leaf_fraction: 1,
        stamp_leaf_fraction: 1,
        whole_reviewed: false,
      });
      expect(db.prepare("SELECT count(*) AS count FROM ability_reviews WHERE whole_context_checked=1").get()).toEqual({ count: 0 });
      const stableRevision = getWorkbenchRevision(db);
      expect(applyStamps(db)).toMatchObject({ applied: 0, changed: false });
      expect(getWorkbenchRevision(db)).toBe(stableRevision);

      const second = proposeStamp(db, { definition: rerollAllDefinition("all", "Independent complete Hit reroll"), positives: [seedReference], counterexamples: [] });
      const secondPreview = previewStamp(db, second.stamp_id, second.revision);
      approveStamp(db, second.stamp_id, second.revision, { reviewer: "fixture-reviewer", preview_hash: secondPreview.preview_hash });
      expect(db.prepare("SELECT count(*) AS count FROM annotations WHERE authority_kind='stamp' AND status='active'").get()).toEqual({ count: 60 });
      expect(db.prepare("SELECT count(*) AS count FROM stamp_applications WHERE status='active'").get()).toEqual({ count: 122 });

      const firstSuspension = suspendStamp(db, first.stamp_id, first.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, first.stamp_id, first.revision).preview_hash,
        reason: "Fixture audit found the first rule unnecessary.",
      });
      expect(firstSuspension.invalidated.annotations).toBe(0);
      expect(db.prepare("SELECT status FROM proposals WHERE id=?").get(pendingProposal)).toEqual({ status: "superseded" });
      expect(db.prepare("SELECT count(*) AS count FROM annotations WHERE authority_kind='stamp' AND status='active'").get()).toEqual({ count: 60 });
      const restored = undoBatch(db, firstSuspension.batch_id, { reviewer: "fixture-reviewer" });
      expect(restored.batch_id).toBe(firstSuspension.batch_id);
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(first.stamp_id, first.revision)).toEqual({ status: "approved" });

      suspendStamp(db, first.stamp_id, first.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, first.stamp_id, first.revision).preview_hash,
        reason: "Fixture authority withdrawal.",
      });
      const finalSuspension = suspendStamp(db, second.stamp_id, second.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, second.stamp_id, second.revision).preview_hash,
        reason: "Fixture authority withdrawal.",
      });
      expect(finalSuspension.invalidated.annotations).toBe(60);
      expect(db.prepare("SELECT status FROM proposals WHERE id=?").get(pendingProposal)).toEqual({ status: "pending" });
      expect(db.prepare("SELECT count(*) AS count FROM annotations WHERE authority_kind='stamp' AND status='active'").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT count(*) AS count FROM annotations WHERE authority_kind='human' AND status='active'").get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("refuses a literal grant without an exact human seed", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const ability = addAbility(db, "unreviewed", "Re-roll the Hit roll.");
      const proposed = proposeStamp(db, {
        definition: rerollAllDefinition(),
        positives: [reference(ability)],
        counterexamples: [],
      });
      const unreviewedPreview = previewStamp(db, proposed.stamp_id, proposed.revision);
      expect(() => approveStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: unreviewedPreview.preview_hash,
      })).toThrow(/human-confirmed positive/i);
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(proposed.stamp_id, proposed.revision))
        .toEqual({ status: "proposed" });

      confirmReroll(db, ability, "all");
      const reviewedPreview = previewStamp(db, proposed.stamp_id, proposed.revision);
      expect(reviewedPreview.totals).toEqual({ eligible: 0, already_satisfied: 1, blocked: 0 });
      expect(approveStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: reviewedPreview.preview_hash,
      })).toMatchObject({ applied: 0, already_satisfied: 1, blocked: 0 });
    } finally {
      db.close();
    }
  });

  it("approves challenged typed forms without widening enum, integer, source-type, or terminal boundaries", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const valid = [
        addAbility(db, "hit-all", "Re-roll the Hit roll."),
        addAbility(db, "wound-all", "Re-roll the Wound roll."),
        addAbility(db, "hit-ones", "Re-roll Hit rolls of 1."),
        addAbility(db, "wound-ones", "Re-roll Wound rolls of 1."),
      ];
      const excluded = [
        addAbility(db, "one-hit", "Re-roll one Hit roll."),
        addAbility(db, "of-ten", "Re-roll the Hit roll of 10."),
        addAbility(db, "negated", "Never Re-roll the Hit roll."),
        addAbility(db, "unknown-enum", "Re-roll the Save roll."),
        addAbility(db, "wrong-source-type", "Re-roll the Hit roll.", "stratagem"),
      ];
      const proposed = proposeStamp(db, {
        definition: typedRerollDefinition(),
        positives: [reference(valid[0]!)],
        counterexamples: excluded.map((ability) => reference(ability, ability.source.slice(0, -1))),
      });
      expect(() => approveStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, proposed.stamp_id, proposed.revision).preview_hash,
      })).toThrow(/challenge run/i);
      attachClearChallenge(db, proposed.stamp_id, proposed.revision);
      const preview = previewStamp(db, proposed.stamp_id, proposed.revision);
      expect(preview.totals).toEqual({ eligible: 4, already_satisfied: 0, blocked: 0 });
      expect(preview.parameter_combinations.map((parameters) => `${parameters.roll}:${parameters.subset}`).sort()).toEqual([
        "hit:all",
        "hit:ones",
        "wound:all",
        "wound:ones",
      ]);
      expect(approveStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: preview.preview_hash,
      })).toMatchObject({ applied: 4, already_satisfied: 0, blocked: 0 });

      const annotations = db.prepare(`
        SELECT source_spans.ability_version_id, fingerprints.parameters_json
        FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
        WHERE annotations.status = 'active'
      `).all() as Array<{ ability_version_id: number; parameters_json: string }>;
      expect(annotations.map((annotation) => JSON.parse(annotation.parameters_json) as Record<string, unknown>)
        .map((parameters) => `${parameters.roll}:${parameters.subset}`).sort()).toEqual([
        "hit:all",
        "hit:ones",
        "wound:all",
        "wound:ones",
      ]);
      const excludedIds = new Set(excluded.map((ability) => ability.id));
      expect(annotations.some((annotation) => excludedIds.has(annotation.ability_version_id))).toBe(false);
    } finally {
      db.close();
    }
  });

  it("blocks conflicting rules together and preserves a later human correction through replay and undo", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const allSeed = addAbility(db, "all-seed", "Re-roll the Hit roll.");
      const onesSeed = addAbility(db, "ones-seed", "Re-roll the Hit roll.");
      const target = addAbility(db, "target", "Re-roll the Hit roll.");
      confirmReroll(db, allSeed, "all");
      confirmReroll(db, onesSeed, "ones");

      const allStamp = proposeStamp(db, {
        definition: rerollAllDefinition("all", "All rerolls"),
        positives: [reference(allSeed)],
        counterexamples: [],
      });
      approveStamp(db, allStamp.stamp_id, allStamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, allStamp.stamp_id, allStamp.revision).preview_hash,
      });
      expect(db.prepare(`
        SELECT count(*) AS count FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(target.id)).toEqual({ count: 1 });

      const onesStamp = proposeStamp(db, {
        definition: rerollAllDefinition("ones", "Ones rerolls"),
        positives: [reference(onesSeed)],
        counterexamples: [],
      });
      const onesPreview = previewStamp(db, onesStamp.stamp_id, onesStamp.revision);
      expect(onesPreview.examples).toContainEqual(expect.objectContaining({
        ability_version_id: target.id,
        status: "blocked",
        reason_code: "CONFLICT",
      }));
      approveStamp(db, onesStamp.stamp_id, onesStamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: onesPreview.preview_hash,
      });
      expect(db.prepare(`
        SELECT count(*) AS count FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(target.id)).toEqual({ count: 0 });
      expect(db.prepare(`
        SELECT reason_code, count(*) AS count FROM stamp_applications
        WHERE ability_version_id=? AND status='blocked'
        GROUP BY reason_code
      `).all(target.id)).toEqual([{ reason_code: "CONFLICT", count: 2 }]);
      expect(db.prepare(`
        SELECT count(*) AS count FROM stamp_applications
        JOIN source_spans ON source_spans.id = stamp_applications.span_id
        WHERE stamp_applications.ability_version_id=?
          AND stamp_applications.status='blocked'
          AND source_spans.fragment='RAW_TEXT'
          AND source_spans.start_byte=0
          AND source_spans.end_byte=?
          AND source_spans.exact_text='Re-roll the Hit roll'
      `).get(target.id, Buffer.byteLength("Re-roll the Hit roll", "utf8"))).toEqual({ count: 2 });
      expect(db.prepare(`
        SELECT source_spans.fragment, source_spans.start_byte,
          source_spans.end_byte, source_spans.exact_text
        FROM escalation_members
        JOIN source_spans ON source_spans.id = escalation_members.span_id
        WHERE escalation_members.ability_version_id=?
          AND escalation_members.status='active'
        LIMIT 1
      `).get(target.id)).toEqual({
        fragment: "RAW_TEXT",
        start_byte: 0,
        end_byte: Buffer.byteLength("Re-roll the Hit roll", "utf8"),
        exact_text: "Re-roll the Hit roll",
      });

      suspendStamp(db, onesStamp.stamp_id, onesStamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, onesStamp.stamp_id, onesStamp.revision).preview_hash,
        reason: "Resolve the fixture conflict in favor of the all-rerolls rule.",
      });
      const derived = db.prepare(`
        SELECT annotations.id
        FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(target.id) as { id: number };
      const correction = applyAnnotationBatch(db, {
        reviewer: "fixture-reviewer",
        decisions: [{
          action: "correct",
          ...reference(target),
          supersedes_annotation_id: derived.id,
          role: "EFFECT",
          family_id: "reroll",
          family_version: 1,
          parameters: { roll: "hit", subset: "ones" },
        }],
      });
      expect(applyStamps(db)).toMatchObject({ applied: 0, changed: false });
      expect(db.prepare(`
        SELECT annotations.authority_kind, fingerprints.parameters_json
        FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
        WHERE source_spans.ability_version_id=? AND annotations.status='active'
      `).all(target.id)).toEqual([
        { authority_kind: "human", parameters_json: JSON.stringify({ roll: "hit", subset: "ones" }) },
      ]);

      const revised = proposeStamp(db, {
        stamp_id: allStamp.stamp_id,
        base_revision: allStamp.revision,
        definition: rerollAllDefinition("all", "Revised all rerolls"),
        positives: [reference(allSeed)],
        counterexamples: [],
      });
      const revisedApproval = approveStamp(db, revised.stamp_id, revised.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, revised.stamp_id, revised.revision).preview_hash,
      });
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(allStamp.stamp_id, allStamp.revision))
        .toEqual({ status: "superseded" });
      undoBatch(db, revisedApproval.approval_batch_id, { reviewer: "fixture-reviewer" });
      expect(db.prepare("SELECT status FROM stamps WHERE id=? AND revision=?").get(revised.stamp_id, revised.revision))
        .toEqual({ status: "suspended" });
      expect(db.prepare(`
        SELECT annotations.id FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.status='active' AND annotations.authority_kind='human'
      `).all(target.id)).toHaveLength(1);
      expect(db.prepare("SELECT operation FROM annotation_batches WHERE id=?").get(correction.batch_id)).toEqual({ operation: "review" });
    } finally {
      db.close();
    }
  });

  it("invalidates changed source and never revives a suspended rule when an old hash returns", () => {
    const stored = sourceStore([
      { id: "seed", raw_text: "Re-roll the Hit roll." },
      { id: "target", raw_text: "Re-roll the Hit roll." },
    ]);
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      refreshSources(db, stored.directory);
      const rows = db.prepare("SELECT id, ability_id, source_hash, source_text FROM abilities WHERE current=1 ORDER BY ability_id")
        .all() as Array<{ id: number; ability_id: string; source_hash: string; source_text: string }>;
      const seedRow = rows.find((row) => row.ability_id === "seed")!;
      const targetRow = rows.find((row) => row.ability_id === "target")!;
      const seed: AbilityFixture = { id: seedRow.id, source: seedRow.source_text, sourceHash: seedRow.source_hash };
      confirmReroll(db, seed, "all");
      const stamp = proposeStamp(db, {
        definition: rerollAllDefinition(),
        positives: [reference(seed)],
        counterexamples: [],
      });
      approveStamp(db, stamp.stamp_id, stamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, stamp.stamp_id, stamp.revision).preview_hash,
      });
      expect(db.prepare(`
        SELECT count(*) AS count FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(targetRow.id)).toEqual({ count: 1 });

      writeFileSync(stored.file, JSON.stringify([
        { id: "seed", raw_text: "Re-roll the Hit roll." },
        { id: "target", raw_text: "This source no longer has that rule." },
      ]));
      refreshSources(db, stored.directory);
      expect(db.prepare(`
        SELECT count(*) AS count FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(targetRow.id)).toEqual({ count: 0 });

      const suspension = suspendStamp(db, stamp.stamp_id, stamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, stamp.stamp_id, stamp.revision).preview_hash,
        reason: "Withdraw fixture authority before restoring the source.",
      });
      writeFileSync(stored.file, JSON.stringify([
        { id: "seed", raw_text: "Re-roll the Hit roll." },
        { id: "target", raw_text: "Re-roll the Hit roll." },
      ]));
      expect(refreshSources(db, stored.directory).reactivated).toBe(1);

      expect(db.prepare("SELECT current FROM abilities WHERE id=?").get(targetRow.id)).toEqual({ current: 1 });
      expect(db.prepare(`
        SELECT count(*) AS count FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(targetRow.id)).toEqual({ count: 0 });

      undoBatch(db, suspension.batch_id, { reviewer: "fixture-reviewer" });
      expect(db.prepare(`
        SELECT count(*) AS count FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id=? AND annotations.authority_kind='stamp' AND annotations.status='active'
      `).get(targetRow.id)).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("requires an explicit named containment grant for cross-role human overlap", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const seed = addAbility(db, "containment-seed", "Re-roll the Hit roll.");
      const target = addAbility(db, "containment-target", "Re-roll the Hit roll.");
      confirmReroll(db, seed, "all");
      applyAnnotationBatch(db, {
        reviewer: "fixture-reviewer",
        decisions: [{
          action: "confirm",
          ...reference(target),
          role: "CONDITION",
          family_id: "leading-unit",
          family_version: 1,
          parameters: { subject: "this-unit" },
        }],
      });

      const denied = proposeStamp(db, {
        definition: rerollAllDefinition("all", "Containment denied"),
        positives: [reference(seed)],
        counterexamples: [],
      });
      const deniedPreview = previewStamp(db, denied.stamp_id, denied.revision);
      expect(deniedPreview.examples).toContainEqual(expect.objectContaining({
        ability_version_id: target.id,
        status: "blocked",
        reason_code: "HUMAN_CONFLICT",
      }));
      approveStamp(db, denied.stamp_id, denied.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: deniedPreview.preview_hash,
      });
      suspendStamp(db, denied.stamp_id, denied.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, denied.stamp_id, denied.revision).preview_hash,
        reason: "Replace the fixture rule with an explicitly scoped containment.",
      });

      const base = rerollAllDefinition("all", "Containment allowed");
      const allowed = proposeStamp(db, {
        definition: {
          ...base,
          variants: [{
            ...base.variants[0]!,
            allow_containment: [{
              other_family_id: "leading-unit",
              other_family_version: 1,
              direction: "contains" as const,
            }],
          }],
        },
        positives: [reference(seed)],
        counterexamples: [],
      });
      const allowedPreview = previewStamp(db, allowed.stamp_id, allowed.revision);
      expect(allowedPreview.examples).toContainEqual(expect.objectContaining({
        ability_version_id: target.id,
        status: "eligible",
      }));
      approveStamp(db, allowed.stamp_id, allowed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: allowedPreview.preview_hash,
      });
      expect(db.prepare(`
        SELECT semantic_families.role, annotations.authority_kind
        FROM annotations
        JOIN source_spans ON source_spans.id = annotations.span_id
        JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
        JOIN semantic_families ON semantic_families.id = fingerprints.family_id
          AND semantic_families.version = fingerprints.family_version
        WHERE source_spans.ability_version_id=? AND annotations.status='active'
        ORDER BY semantic_families.role
      `).all(target.id)).toEqual([
        { role: "CONDITION", authority_kind: "human" },
        { role: "EFFECT", authority_kind: "stamp" },
      ]);
    } finally {
      db.close();
    }
  });

  it("keeps a distinct stamped fingerprint active when a rejected proposal shares its exact span", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const seed = addAbility(db, "seed", "Re-roll the Hit roll.");
      const target = addAbility(db, "target", "Re-roll the Hit roll.");
      confirmReroll(db, seed, "all");
      const stamp = proposeStamp(db, {
        definition: rerollAllDefinition(),
        positives: [reference(seed)],
        counterexamples: [],
      });
      approveStamp(db, stamp.stamp_id, stamp.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, stamp.stamp_id, stamp.revision).preview_hash,
      });
      const targetReference = reference(target);
      const spanId = insertSpan(
        db,
        target.id,
        targetReference.fragment,
        targetReference.start_byte,
        targetReference.end_byte,
        targetReference.exact_text,
      );
      const rejectedFingerprint = validateFingerprint(
        db,
        "reroll",
        { roll: "hit", subset: "ones" },
        1,
        targetReference.exact_text,
      );
      const proposalId = Number(db.prepare(`
        INSERT INTO proposals (
          span_id, fingerprint_id, role, origin, status, reason_json, created_at
        ) VALUES (?, ?, 'EFFECT', 'fixture', 'pending', '{}', ?)
      `).run(spanId, rejectedFingerprint, "2026-01-01T00:00:00.000Z").lastInsertRowid);

      applyAnnotationBatch(db, {
        reviewer: "fixture-reviewer",
        decisions: [{
          action: "reject",
          proposal_id: proposalId,
          ...targetReference,
          role: "EFFECT",
        }],
      });

      expect(db.prepare(`
        SELECT stamp_applications.status, stamp_applications.reason_code,
          fingerprints.parameters_json
        FROM stamp_applications
        JOIN annotations ON annotations.id = stamp_applications.annotation_id
        JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
        WHERE stamp_applications.stamp_id = ?
          AND stamp_applications.ability_version_id = ?
      `).get(stamp.stamp_id, target.id)).toEqual({
        status: "active",
        reason_code: null,
        parameters_json: JSON.stringify({ roll: "hit", subset: "all" }),
      });
      expect(getAbilityCoverage(db, target.id)).toMatchObject({ leaf_fraction: 1, stamp_leaf_fraction: 1 });
    } finally {
      db.close();
    }
  });

  it("stores private approval objections and suspension or rejection reasons in batch metadata", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const ability = addAbility(db, "rationale", "Re-roll the Hit roll.");
      confirmReroll(db, ability, "all");
      const proposed = proposeStamp(db, {
        definition: typedRerollDefinition(),
        positives: [reference(ability)],
        counterexamples: [],
      });
      attachClearChallenge(db, proposed.stamp_id, proposed.revision, "objection");
      const approval = approveStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, proposed.stamp_id, proposed.revision).preview_hash,
        objection_resolution: "The exact typed form is intentionally bounded to this reviewed spelling.",
      });
      expect(JSON.parse((db.prepare("SELECT metadata_json FROM annotation_batches WHERE id=?")
        .get(approval.approval_batch_id) as { metadata_json: string }).metadata_json)).toEqual({
        objection_resolution: "The exact typed form is intentionally bounded to this reviewed spelling.",
      });

      const suspension = suspendStamp(db, proposed.stamp_id, proposed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, proposed.stamp_id, proposed.revision).preview_hash,
        reason: "A later audit found the typed boundary unsafe.",
      });
      expect(JSON.parse((db.prepare("SELECT metadata_json FROM annotation_batches WHERE id=?")
        .get(suspension.batch_id) as { metadata_json: string }).metadata_json)).toEqual({
        reason: "A later audit found the typed boundary unsafe.",
      });

      const rejected = proposeStamp(db, {
        definition: rerollAllDefinition("all", "Rejected rationale fixture"),
        positives: [reference(ability)],
        counterexamples: [],
      });
      const rejection = rejectStamp(db, rejected.stamp_id, rejected.revision, {
        reviewer: "fixture-reviewer",
        definition_hash: previewStamp(db, rejected.stamp_id, rejected.revision).definition_hash,
        reason: "The literal proposal duplicates a narrower reviewed rule.",
      });
      expect(JSON.parse((db.prepare("SELECT metadata_json FROM annotation_batches WHERE id=?")
        .get(rejection.batch_id) as { metadata_json: string }).metadata_json)).toEqual({
        reason: "The literal proposal duplicates a narrower reviewed rule.",
      });
      const privateExport = getPrivateExport(db) as {
        decision_batches: Array<{ id: string; metadata: Record<string, unknown> }>;
      };
      expect(privateExport.decision_batches.find((batch) => batch.id === approval.approval_batch_id)?.metadata).toEqual({
        objection_resolution: "The exact typed form is intentionally bounded to this reviewed spelling.",
      });
      expect(privateExport.decision_batches.find((batch) => batch.id === suspension.batch_id)?.metadata).toEqual({
        reason: "A later audit found the typed boundary unsafe.",
      });
      expect(privateExport.decision_batches.find((batch) => batch.id === rejection.batch_id)?.metadata).toEqual({
        reason: "The literal proposal duplicates a narrower reviewed rule.",
      });
    } finally {
      db.close();
    }
  });

  it("keeps stamp pagination on its original snapshot when a newer stamp is inserted", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const ability = addAbility(db, "pagination", "Re-roll the Hit roll.");
      for (let index = 0; index < 21; index += 1) {
        proposeStamp(db, {
          definition: rerollAllDefinition("all", `Pagination ${index}`),
          positives: [reference(ability)],
          counterexamples: [],
        });
      }
      const snapshotIds = (db.prepare(`
        SELECT id, revision FROM stamps ORDER BY created_at DESC, id, revision
      `).all() as Array<{ id: string; revision: number }>).map((row) => `${row.id}@${row.revision}`);
      const first = listStamps(db);
      expect(first.items).toHaveLength(20);
      expect(first.next_cursor).not.toBeNull();
      proposeStamp(db, {
        definition: rerollAllDefinition("all", "Inserted after first page"),
        positives: [reference(ability)],
        counterexamples: [],
      });
      const second = listStamps(db, { cursor: first.next_cursor! });
      const pagedIds = [...first.items, ...second.items].map((row) => `${row.id}@${row.revision}`);
      expect(pagedIds).toEqual(snapshotIds);
      expect(second.total).toBe(snapshotIds.length);
    } finally {
      db.close();
    }
  });

  it("reports the approval prerequisite instead of letting a reviewer discover it on submit", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const ability = addAbility(db, "eligibility", "Re-roll the Hit roll.");
      const typed = proposeStamp(db, {
        definition: typedRerollDefinition(),
        positives: [reference(ability)],
        counterexamples: [],
      });
      const challengeMissing = stampApprovalEligibility(db, typed.stamp_id, typed.revision);
      expect(challengeMissing.approvable).toBe(false);
      expect(challengeMissing.blocker).toMatchObject({ code: "CHALLENGE_MISSING", next_action: "prepare-challenge" });
      expect(challengeMissing.challenge).toMatchObject({ required: true, state: "missing", run_id: null });
      expect(() => approveStamp(db, typed.stamp_id, typed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, typed.stamp_id, typed.revision).preview_hash,
      })).toThrow(challengeMissing.blocker!.message);

      attachClearChallenge(db, typed.stamp_id, typed.revision, "objection");
      const objected = stampApprovalEligibility(db, typed.stamp_id, typed.revision);
      expect(objected).toMatchObject({
        approvable: false,
        blocker: { code: "CHALLENGE_OBJECTION", next_action: "resolve-objection" },
        challenge: { required: true, state: "objection", verdict: "objection" },
      });
      expect(() => approveStamp(db, typed.stamp_id, typed.revision, {
        reviewer: "fixture-reviewer",
        preview_hash: previewStamp(db, typed.stamp_id, typed.revision).preview_hash,
      })).toThrow(/objected without a human resolution/i);

      attachClearChallenge(db, typed.stamp_id, typed.revision, "clear");
      expect(stampApprovalEligibility(db, typed.stamp_id, typed.revision)).toMatchObject({
        approvable: true,
        blocker: null,
        challenge: { required: true, state: "clear", verdict: "clear" },
      });

      // A literal rule is not challenged but still needs a real human-confirmed occurrence.
      const literal = proposeStamp(db, { definition: rerollAllDefinition(), positives: [reference(ability)], counterexamples: [] });
      const unseeded = stampApprovalEligibility(db, literal.stamp_id, literal.revision);
      expect(unseeded).toMatchObject({
        approvable: false,
        blocker: { code: "HUMAN_SEED", next_action: "seed-occurrence" },
        challenge: { required: false, state: "not-required" },
      });
      confirmReroll(db, ability, "all");
      expect(stampApprovalEligibility(db, literal.stamp_id, literal.revision)).toMatchObject({ approvable: true, blocker: null });

      rejectStamp(db, literal.stamp_id, literal.revision, {
        reviewer: "fixture-reviewer",
        definition_hash: previewStamp(db, literal.stamp_id, literal.revision).definition_hash,
        reason: "Superseded by the typed rule under review.",
      });
      expect(stampApprovalEligibility(db, literal.stamp_id, literal.revision)).toMatchObject({
        approvable: false,
        blocker: { code: "STATE", next_action: "none" },
      });
    } finally {
      db.close();
    }
  });
});

describe("Round 5C matcher equivalence and preview snapshots", () => {
  const leafVariants = validateStampDefinition({
    schema_version: 1,
    kind: "leaf",
    label: "Matcher equivalence corpus",
    variants: [{
      id: "typed",
      source_types: "any",
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "prefix", literal: "re-roll the " },
        { id: "roll_form", slot: "roll" },
        { id: "suffix", literal: " roll" },
      ] }],
      slots: { roll: { kind: "enum", values: [{ text: "Hit", value: "hit" }, { text: "Hit and Wound", value: "both" }, { text: "Wound", value: "wound" }] } },
      before: [{ boundary: "word" }],
      after: [{ literal: "." }, { boundary: "fragment" }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: { $case: "roll", cases: [{ value: "hit", then: "hit" }, { value: "both", then: "hit" }, { value: "wound", then: "wound" }] }, subset: "all" } },
      allow_containment: [],
    }, {
      id: "integer",
      source_types: "any",
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "amount", slot: "amount" },
        { id: "suffix", literal: " to the Hit roll" },
      ] }],
      slots: { amount: { kind: "integer", min: -3, max: 12 } },
      before: [{ boundary: "word" }, { literal: "add " }],
      after: [{ literal: "." }, { literal: " and" }],
      output: { family_id: "roll-modifier", family_version: 1, parameters: { roll: "hit", operation: "add", value: { $bind: "amount" } } },
      allow_containment: [],
    }, {
      // Overlapping enum spellings that both complete: result order follows declared enum order.
      id: "open_enum",
      source_types: "any",
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "prefix", literal: "re-roll the " },
        { id: "roll_form", slot: "roll" },
      ] }],
      slots: { roll: { kind: "enum", values: [{ text: "Hit", value: "hit" }, { text: "Hit roll", value: "hit_roll" }] } },
      before: [{ boundary: "word" }],
      after: [{ boundary: "word" }, { boundary: "fragment" }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "all" } },
      allow_containment: [],
    }, {
      // A trailing integer whose guard would accept a decimal or exponent tail if the
      // matcher failed to reject it.
      id: "bare_integer",
      source_types: "any",
      fragments: [{ fragment: "RAW_TEXT", segments: [
        { id: "verb", literal: "add " },
        { id: "amount", slot: "amount" },
      ] }],
      slots: { amount: { kind: "integer", min: 0, max: 9 } },
      before: [{ boundary: "word" }],
      after: [{ literal: "." }, { literal: "e" }],
      output: { family_id: "roll-modifier", family_version: 1, parameters: { roll: "hit", operation: "add", value: { $bind: "amount" } } },
      allow_containment: [],
    }, {
      // A self-overlapping literal: the only complete match starts inside an earlier occurrence.
      id: "overlap",
      source_types: "any",
      fragments: [{ fragment: "RAW_TEXT", segments: [{ id: "form", literal: "hit hit" }] }],
      slots: {},
      before: [{ boundary: "word" }],
      after: [{ literal: "." }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "all" } },
      allow_containment: [],
    }, {
      id: "edge_space",
      source_types: "any",
      fragments: [{ fragment: "RAW_TEXT", segments: [{ id: "form", literal: " critical  hit" }] }],
      slots: {},
      before: [{ boundary: "word" }],
      after: [{ boundary: "word" }, { boundary: "fragment" }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "all" } },
      allow_containment: [],
    }],
  });
  if (leafVariants.kind !== "leaf") throw new Error("fixture must be a leaf definition");
  const sources = [
    "Re-roll the Hit roll. Re-roll the Hit and Wound roll. Re-roll the Wound roll",
    "You can re‑roll the HIT roll.Then re–roll the wound roll.",
    "Add +2 to the Hit roll. add 10 to the Hit roll and add 2.0 to the Hit roll. add 2e0 to the Hit roll.",
    "add １２ to the Hit roll. add -3 to the Hit roll. add 13 to the Hit roll.",
    "Each critical \t\n hit counts; a critical hit and café critical hitter.",
    "ﬁre: re-roll the Hit roll. 👩‍👩‍👧 re-roll the Wound roll. 再 re-roll the Hit roll.",
    "   leading whitespace re-roll the Hit roll   ",
    "Re-roll the Hít roll. Re-roll the Hit roll",
    "add 2.5 then add 2e0 then add 3. then add 4e then add 5.x, re-roll the Hit roll now",
    "hit hit hit. HIT HIT HIT HIT.",
  ];

  it("returns results identical to the frozen v1 matcher, with or without a shared scan", () => {
    const scan = createFragmentScan();
    let compared = 0;
    for (const source of sources) {
      const fragment = { fragment: "RAW_TEXT", start_byte: 7, end_byte: 7 + Buffer.byteLength(source, "utf8"), text: source };
      for (const variant of leafVariants.variants) {
        for (const complete of [false, true]) {
          const options = { complete, before: variant.before, after: variant.after };
          const expected = referenceMatchFragmentPattern(variant.fragments[0], variant.slots, fragment, options);
          expect(matchFragmentPattern(variant.fragments[0], variant.slots, fragment, options)).toEqual(expected);
          expect(JSON.stringify(matchFragmentPattern(variant.fragments[0], variant.slots, fragment, { ...options, scan }))).toBe(JSON.stringify(expected));
          compared += expected.length;
        }
      }
    }
    // The corpus must actually exercise matches, not just agree on empty results.
    expect(compared).toBeGreaterThan(12);
  });

  it("puts an epoch trigger on every persisted table", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializeWorkbench(db);
      const tables = (db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name <> 'workbench_state' AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'source_chunks_fts%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'
      `).all() as Array<{ name: string }>).map((row) => row.name);
      const triggers = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>).map((row) => row.name));
      expect(tables.length).toBeGreaterThan(15);
      for (const table of tables) {
        for (const event of ["insert", "update", "delete"]) expect(triggers, `${table} ${event}`).toContain(`${table}_epoch_${event}`);
      }
    } finally {
      db.close();
    }
  });

  it("serves cached pages only while persisted state is unchanged", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializeWorkbench(db);
      const seed = addAbility(db, "seed", "Re-roll the Hit roll.");
      const others = Array.from({ length: 24 }, (_, index) => addAbility(db, `other-${index}`, "Re-roll the Hit roll."));
      confirmReroll(db, seed, "all");
      const { stamp_id: stampId, revision } = proposeStamp(db, { definition: rerollAllDefinition(), positives: [reference(seed)], counterexamples: [] });
      const first = previewStamp(db, stampId, revision);
      expect(first.totals).toEqual({ eligible: 24, already_satisfied: 1, blocked: 0 });
      // A caller mutating its copy must not poison the cached snapshot.
      first.examples.splice(0);
      (first.totals as { eligible: number }).eligible = -1;
      const repeat = previewStamp(db, stampId, revision);
      expect(repeat.preview_hash).toBe(first.preview_hash);
      expect(repeat.totals.eligible).toBe(24);
      expect(repeat.examples).toHaveLength(20);
      const second = previewStamp(db, stampId, revision, { cursor: repeat.next_cursor! });
      expect(second.preview_hash).toBe(first.preview_hash);
      expect(second.examples).toHaveLength(5);

      // A human decision elsewhere changes the preview; the cache must not mask it.
      confirmReroll(db, others[0]!, "all");
      const changed = previewStamp(db, stampId, revision);
      expect(changed.totals).toEqual({ eligible: 23, already_satisfied: 2, blocked: 0 });
      expect(changed.preview_hash).not.toBe(first.preview_hash);
      // A raw write that bypasses every workbench helper still invalidates.
      db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(others[1]!.id);
      expect(previewStamp(db, stampId, revision).totals).toEqual({ eligible: 22, already_satisfied: 2, blocked: 0 });

      expect(() => approveStamp(db, stampId, revision, { reviewer: "fixture-reviewer", preview_hash: changed.preview_hash })).toThrow(/preview changed/i);
      const current = previewStamp(db, stampId, revision);
      expect(approveStamp(db, stampId, revision, { reviewer: "fixture-reviewer", preview_hash: current.preview_hash })).toMatchObject({ applied: 22 });
    } finally {
      db.close();
    }
  });
});

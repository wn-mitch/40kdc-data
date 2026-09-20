import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { exactSpan, familyRole, normalizeFingerprintParameters, validateFamilySource, validateFingerprint, type CompositionStampVariant, type LeafStampVariant, type StampApprovalBlocker, type StampApprovalEligibility, type StampChallengeReview, type StampChallengeState, type StampDefinition, type StampEvidenceReference, type StampPreview, type StampPreviewOccurrence, type StampSourceReference } from "./contracts.js";
import { bumpWorkbenchRevision, getDataEpoch, initializeWorkbench, insertSpan, invalidateStampRevision, parseStoredFragments, retractUnsupportedStampAnnotations, withTransaction } from "./db.js";
import { createFragmentScan, instantiateTemplate, matchFragmentPattern, normalizedSurface, sourceTypeAllowed, validateStampDefinition, type MatchLeafEvidence, type PatternMatch, type PatternSourceFragment, type FragmentScan, type SegmentEvidence } from "./matching.js";
import { applyCompositionStamps } from "./assembly.js";

export const STAMP_MATCHER_VERSION = "round5c/stamp-matcher/v1";
export const STAMP_ASSEMBLER_VERSION = "round5c/stamp-assembler/v1";
const PAGE_SIZE = 20;

export class StampError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StampError";
    this.status = status;
  }
}

type StampRow = {
  id: string;
  revision: number;
  kind: "leaf" | "composition";
  status: "proposed" | "approved" | "rejected" | "suspended" | "superseded";
  definition_json: string;
  definition_hash: string;
  model_run_id: number | null;
  challenge_run_id: number | null;
  approval_batch_id: string | null;
  created_at: string;
  updated_at: string;
};

type AbilityRow = {
  id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  source_type: string | null;
  fragments_json: string;
};

type Candidate = {
  stamp: StampRow;
  definition: Extract<StampDefinition, { kind: "leaf" }>;
  variant: LeafStampVariant;
  ability: AbilityRow;
  match: PatternMatch;
  family_id: string;
  family_version: number;
  role: string;
  parameters: Record<string, unknown>;
  fingerprint_hash: string;
  application_id: string;
  inputs_hash: string;
  dependencies: Record<string, unknown>;
  status: "eligible" | "already-satisfied" | "blocked";
  reason_code: string | null;
  existing_annotation_id: number | null;
};

type ApplicationReport = {
  applied: number;
  already_satisfied: number;
  blocked: number;
  stale: number;
  changed: boolean;
  composition: { proposed: number; blocked: number; stale: number; changed: boolean };
};

function requireStamp(db: DatabaseSync, stampId: string, revision: number): StampRow {
  const row = db.prepare("SELECT * FROM stamps WHERE id = ? AND revision = ?").get(stampId, revision) as StampRow | undefined;
  if (!row) throw new StampError(404, `Unknown stamp ${stampId}@${revision}.`);
  return row;
}

function parsedDefinition(row: StampRow): StampDefinition {
  const definition = validateStampDefinition(JSON.parse(row.definition_json));
  if (definition.kind !== row.kind || hashJson(definition) !== row.definition_hash) throw new Error(`Stored stamp ${row.id}@${row.revision} failed its definition hash.`);
  return definition;
}

function pageOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded) && "offset" in decoded && typeof decoded.offset === "number" && Number.isSafeInteger(decoded.offset) && decoded.offset >= 0) return decoded.offset;
  } catch {
    // Report the stable domain error below.
  }
  throw new StampError(422, "Stamp cursor is malformed.");
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string, label: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) return decoded as Record<string, unknown>;
  } catch {
    // Report the stable domain error below.
  }
  throw new StampError(422, `${label} cursor is malformed.`);
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sourceReference(value: unknown, label: string): StampEvidenceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StampError(422, `${label} must be an object.`);
  const input = value as Record<string, unknown>;
  if (input.synthetic === true) {
    const keys = Object.keys(input);
    if (keys.some((key) => !["synthetic", "source_text", "fragment", "expected_match"].includes(key))
      || typeof input.source_text !== "string" || !input.source_text
      || typeof input.fragment !== "string" || !input.fragment
      || typeof input.expected_match !== "boolean") {
      throw new StampError(422, `${label} synthetic evidence is malformed.`);
    }
    return { synthetic: true, source_text: input.source_text, fragment: input.fragment, expected_match: input.expected_match };
  }
  if (input.synthetic !== undefined && input.synthetic !== false) throw new StampError(422, `${label}.synthetic must be true or false.`);
  const keys = Object.keys(input);
  if (keys.some((key) => !["synthetic", "ability_version_id", "source_hash", "fragment", "start_byte", "end_byte", "exact_text"].includes(key))) {
    throw new StampError(422, `${label} source evidence contains an unsupported field.`);
  }
  const abilityVersionId = input.ability_version_id;
  const sourceHash = input.source_hash;
  const fragment = input.fragment;
  const startByte = input.start_byte;
  const endByte = input.end_byte;
  const exactText = input.exact_text;
  if (typeof abilityVersionId !== "number" || !Number.isSafeInteger(abilityVersionId) || abilityVersionId < 1 || typeof sourceHash !== "string" || sourceHash.length !== 64 || typeof fragment !== "string" || !fragment || typeof startByte !== "number" || !Number.isSafeInteger(startByte) || startByte < 0 || typeof endByte !== "number" || !Number.isSafeInteger(endByte) || endByte <= startByte || typeof exactText !== "string" || !exactText) throw new StampError(422, `${label} source evidence is malformed.`);
  return { ability_version_id: abilityVersionId, source_hash: sourceHash, fragment, start_byte: startByte, end_byte: endByte, exact_text: exactText };
}

function evidenceRows(db: DatabaseSync, stampId: string, revision: number, kind: "positive" | "counterexample"): StampEvidenceReference[] {
  return (db.prepare(`
    SELECT evidence_json FROM stamp_evidence
    WHERE stamp_id = ? AND stamp_revision = ? AND evidence_kind = ? ORDER BY ordinal
  `).all(stampId, revision, kind) as Array<{ evidence_json: string }>).map((row, index) => sourceReference(JSON.parse(row.evidence_json), `${kind}[${index}]`));
}

function abilityFragments(ability: AbilityRow): PatternSourceFragment[] {
  return parseStoredFragments(ability.fragments_json).map((fragment) => ({ fragment: fragment.fragment, start_byte: fragment.start_byte, end_byte: fragment.end_byte, text: fragment.text }));
}

function currentAbilityForReference(db: DatabaseSync, reference: StampSourceReference): AbilityRow {
  const ability = db.prepare(`
    SELECT id, faction_id, ability_id, source_hash, source_text, source_type, fragments_json
    FROM abilities WHERE id = ? AND current = 1 AND source_hash = ?
  `).get(reference.ability_version_id, reference.source_hash) as AbilityRow | undefined;
  if (!ability) throw new StampError(409, "Stamp evidence no longer names a current source version.");
  const fragment = abilityFragments(ability).find((entry) => entry.fragment === reference.fragment && reference.start_byte >= entry.start_byte && reference.end_byte <= entry.end_byte);
  if (!fragment) throw new StampError(409, "Stamp evidence no longer fits its source fragment.");
  let exact: string;
  try {
    exact = exactSpan(ability.source_text, reference.start_byte, reference.end_byte);
  } catch {
    throw new StampError(409, "Stamp evidence offsets no longer name complete source characters.");
  }
  if (exact !== reference.exact_text) throw new StampError(409, "Stamp evidence bytes changed.");
  return ability;
}


/** Per-scan memo of parsed fragments and matcher projections; discarded when the scan returns. */
type LeafScan = { fragments: Map<number, PatternSourceFragment[]>; matcher: FragmentScan };

function createLeafScan(): LeafScan {
  return { fragments: new Map(), matcher: createFragmentScan() };
}

function scannedFragments(ability: AbilityRow, scan: LeafScan | undefined): PatternSourceFragment[] {
  const hit = scan?.fragments.get(ability.id);
  if (hit) return hit;
  const fragments = abilityFragments(ability);
  scan?.fragments.set(ability.id, fragments);
  return fragments;
}

function evaluateVariant(variant: LeafStampVariant, ability: AbilityRow, scan?: LeafScan): Candidate["match"][] {
  if (!sourceTypeAllowed(variant.source_types, ability.source_type)) return [];
  const fragment = scannedFragments(ability, scan).find((entry) => entry.fragment === variant.fragments[0].fragment);
  if (!fragment) return [];
  return matchFragmentPattern(variant.fragments[0], variant.slots, fragment, { complete: false, before: variant.before, after: variant.after, scan: scan?.matcher });
}

type CompositionMatch = {
  variant: CompositionStampVariant;
  bindings: Record<string, unknown>;
  segments: Record<string, SegmentEvidence>;
  leaf_dependencies: number[];
  output_hash: string;
};

function effectiveLeaves(db: DatabaseSync, abilityVersionId: number): MatchLeafEvidence[] {
  const rows = db.prepare(`
    SELECT annotations.id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE source_spans.ability_version_id = ? AND annotations.status = 'active'
      AND (
        annotations.authority_kind = 'human'
        OR EXISTS (
          SELECT 1 FROM stamp_applications
          JOIN stamps ON stamps.id = stamp_applications.stamp_id
            AND stamps.revision = stamp_applications.stamp_revision
          WHERE stamp_applications.annotation_id = annotations.id
            AND stamp_applications.status = 'active' AND stamps.status = 'approved'
        )
      )
    ORDER BY source_spans.start_byte, source_spans.end_byte, annotations.id
  `).all(abilityVersionId) as Array<Omit<MatchLeafEvidence, "parameters"> & { parameters_json: string }>;
  return rows.map(({ parameters_json, ...row }) => ({ ...row, parameters: JSON.parse(parameters_json) as Record<string, unknown> }));
}

function compositionMatches(
  definition: Extract<StampDefinition, { kind: "composition" }>,
  ability: AbilityRow,
  leaves: readonly MatchLeafEvidence[],
): CompositionMatch[] {
  const sourceFragments = abilityFragments(ability);
  const results: CompositionMatch[] = [];
  for (const variant of definition.variants) {
    if (!sourceTypeAllowed(variant.source_types, ability.source_type) || variant.fragments.length !== sourceFragments.length) continue;
    let partials: Array<{ bindings: Record<string, unknown>; segments: Record<string, SegmentEvidence>; leaf_dependencies: number[] }> = [{
      bindings: Object.create(null) as Record<string, unknown>,
      segments: Object.create(null) as Record<string, SegmentEvidence>,
      leaf_dependencies: [],
    }];
    for (let index = 0; index < variant.fragments.length; index += 1) {
      const pattern = variant.fragments[index]!;
      const source = sourceFragments[index]!;
      if (pattern.fragment !== source.fragment) {
        partials = [];
        break;
      }
      const matches = matchFragmentPattern(pattern, variant.slots, source, { complete: true, leaves });
      const next: typeof partials = [];
      for (const partial of partials) {
        for (const match of matches) {
          if (Object.entries(match.bindings).some(([key, value]) => Object.hasOwn(partial.bindings, key) && hashJson(partial.bindings[key]) !== hashJson(value))) continue;
          next.push({
            bindings: { ...partial.bindings, ...match.bindings },
            segments: { ...partial.segments, ...match.segments },
            leaf_dependencies: [...new Set([...partial.leaf_dependencies, ...match.leaf_dependencies])].sort((left, right) => left - right),
          });
        }
      }
      partials = next;
    }
    for (const partial of partials) {
      const graph = instantiateTemplate(variant.graph_template, partial.bindings);
      const mechanics = variant.mechanics_template === null ? null : instantiateTemplate(variant.mechanics_template, partial.bindings);
      results.push({ variant, ...partial, output_hash: hashJson({ graph, mechanics }) });
    }
  }
  const unique = new Map<string, CompositionMatch>();
  for (const match of results) unique.set(hashJson({ variant_id: match.variant.id, bindings: match.bindings, leaf_dependencies: match.leaf_dependencies, output_hash: match.output_hash }), match);
  return [...unique.values()];
}

function evaluateDefinitionAgainstEvidence(db: DatabaseSync, definition: StampDefinition, evidence: StampEvidenceReference): boolean {
  const synthetic = "synthetic" in evidence && evidence.synthetic;
  if (synthetic) {
    const fragment: PatternSourceFragment = { fragment: evidence.fragment, start_byte: 0, end_byte: Buffer.byteLength(evidence.source_text, "utf8"), text: evidence.source_text };
    if (definition.kind === "leaf") return definition.variants.some((variant) => variant.fragments[0].fragment === fragment.fragment
      && matchFragmentPattern(variant.fragments[0], variant.slots, fragment, { complete: false, before: variant.before, after: variant.after }).length > 0);
    const ability: AbilityRow = { id: -1, faction_id: "synthetic", ability_id: "synthetic", source_hash: "0".repeat(64), source_text: evidence.source_text, source_type: null, fragments_json: JSON.stringify([fragment]) };
    return compositionMatches(definition, ability, []).length > 0;
  }
  const ability = currentAbilityForReference(db, evidence);
  if (definition.kind === "leaf") {
    return definition.variants.flatMap((variant) => evaluateVariant(variant, ability))
      .some((match) => match.fragment === evidence.fragment && match.start_byte === evidence.start_byte && match.end_byte === evidence.end_byte && match.exact_text === evidence.exact_text);
  }
  return compositionMatches(definition, ability, effectiveLeaves(db, ability.id)).length > 0;
}

function validateEvidence(db: DatabaseSync, definition: StampDefinition, positives: StampEvidenceReference[], counterexamples: StampEvidenceReference[]): void {
  if (positives.length === 0) throw new StampError(422, "A stamp proposal requires at least one positive case.");
  for (const [index, evidence] of positives.entries()) {
    if (!evaluateDefinitionAgainstEvidence(db, definition, evidence)) throw new StampError(422, `Positive case ${index} does not match the exact matcher.`);
    if ("synthetic" in evidence && evidence.synthetic && !evidence.expected_match) throw new StampError(422, `Positive synthetic case ${index} must expect a match.`);
  }
  for (const [index, evidence] of counterexamples.entries()) {
    const matched = evaluateDefinitionAgainstEvidence(db, definition, evidence);
    if ("synthetic" in evidence && evidence.synthetic) {
      if (evidence.expected_match !== matched) throw new StampError(422, `Synthetic counterexample ${index} produced an unexpected matcher result.`);
    } else if (matched) {
      throw new StampError(422, `Counterexample ${index} is still matched by the definition.`);
    }
  }
}

function nextRevision(db: DatabaseSync, stampId: string): number {
  const row = db.prepare("SELECT max(revision) AS revision FROM stamps WHERE id = ?").get(stampId) as { revision: number | null };
  return (row.revision ?? 0) + 1;
}

function insertProposedStamp(db: DatabaseSync, body: { stamp_id?: string; base_revision?: number; definition: unknown; positives: unknown[]; counterexamples: unknown[] }, modelRunId: number | null, bumpRevision: boolean): { stamp_id: string; revision: number } {
  initializeWorkbench(db);
  if (!Array.isArray(body.positives) || !Array.isArray(body.counterexamples)) {
    throw new StampError(422, "positives and counterexamples must be arrays.");
  }
  const definition = validateStampDefinition(body.definition);
  const positives = body.positives.map((value, index) => sourceReference(value, `positives[${index}]`));
  const counterexamples = body.counterexamples.map((value, index) => sourceReference(value, `counterexamples[${index}]`));
  validateEvidence(db, definition, positives, counterexamples);
  const hasStampId = typeof body.stamp_id === "string" && Boolean(body.stamp_id.trim());
  const hasBaseRevision = body.base_revision !== undefined;
  if (hasStampId !== hasBaseRevision) throw new StampError(422, "stamp_id and base_revision are required together for a revision.");
  const stampId = hasStampId ? body.stamp_id!.trim() : `stamp_${randomUUID()}`;
  let revision = 1;
  if (hasStampId) {
    if (!Number.isSafeInteger(body.base_revision) || body.base_revision! < 1) throw new StampError(422, "base_revision must be positive.");
    const head = db.prepare("SELECT max(revision) AS revision FROM stamps WHERE id = ?").get(stampId) as { revision: number | null };
    if (head.revision !== body.base_revision) throw new StampError(409, "base_revision is not the current stamp head.");
    revision = nextRevision(db, stampId);
  }
  const now = new Date().toISOString();
  const definitionHash = hashJson(definition);
  db.prepare(`
    INSERT INTO stamps (id, revision, kind, status, definition_json, definition_hash, model_run_id, challenge_run_id, approval_batch_id, created_at, updated_at)
    VALUES (?, ?, ?, 'proposed', ?, ?, ?, NULL, NULL, ?, ?)
  `).run(stampId, revision, definition.kind, JSON.stringify(definition), definitionHash, modelRunId, now, now);
  const insertEvidence = db.prepare("INSERT INTO stamp_evidence (stamp_id, stamp_revision, evidence_kind, ordinal, evidence_json) VALUES (?, ?, ?, ?, ?)");
  positives.forEach((value, index) => insertEvidence.run(stampId, revision, "positive", index, JSON.stringify(value)));
  counterexamples.forEach((value, index) => insertEvidence.run(stampId, revision, "counterexample", index, JSON.stringify(value)));
  if (bumpRevision) bumpWorkbenchRevision(db);
  return { stamp_id: stampId, revision };
}

export function proposeStamp(db: DatabaseSync, body: { stamp_id?: string; base_revision?: number; definition: unknown; positives: unknown[]; counterexamples: unknown[] }): { stamp_id: string; revision: number } {
  return withTransaction(db, () => insertProposedStamp(db, body, null, true));
}

export function proposeStampFromModel(db: DatabaseSync, body: { stamp_id?: string; base_revision?: number; definition: unknown; positives: unknown[]; counterexamples: unknown[] }, modelRunId: number, options: { bump_revision?: boolean } = {}): { stamp_id: string; revision: number } {
  return withTransaction(db, () => insertProposedStamp(db, body, modelRunId, options.bump_revision !== false));
}

export function proposeLiteralStamp(db: DatabaseSync, body: { annotation_id: number; reviewer: string; label?: string }): { stamp_id: string; revision: number } {
  const row = db.prepare(`
    SELECT annotations.id, annotations.authority_kind, annotations.status, source_spans.ability_version_id,
      source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_spans.exact_text,
      abilities.source_hash, abilities.source_type, abilities.fragments_json,
      fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.id = ? AND abilities.current = 1
  `).get(body.annotation_id) as {
    id: number; authority_kind: string; status: string; ability_version_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string; source_hash: string; source_type: string | null; fragments_json: string; family_id: string; family_version: number; parameters_json: string;
  } | undefined;
  if (!row || row.status !== "active" || row.authority_kind !== "human") throw new StampError(422, "Create stamp requires a current human-confirmed annotation.");
  const fragment = parseStoredFragments(row.fragments_json).find((candidate) => candidate.fragment === row.fragment && row.start_byte >= candidate.start_byte && row.end_byte <= candidate.end_byte);
  if (!fragment) throw new Error("Confirmed annotation no longer fits its source fragment.");
  const localEnd = row.end_byte - fragment.start_byte;
  const bytes = Buffer.from(fragment.text, "utf8");
  const after: LeafStampVariant["after"] = [];
  if (row.end_byte === fragment.end_byte) after.push({ boundary: "fragment" });
  else {
    const remainder = bytes.subarray(localEnd).toString("utf8");
    const punctuation = /^\s*([\p{P}\p{S}]+)/u.exec(remainder)?.[0];
    if (!punctuation) throw new StampError(422, "The selected literal has no safe terminal boundary; revise it with an explicit continuation guard.");
    after.push({ literal: punctuation });
  }
  const before: LeafStampVariant["before"] = row.start_byte === fragment.start_byte ? [{ boundary: "fragment" }] : [{ boundary: "word" }];
  const definition: StampDefinition = {
    schema_version: 1,
    kind: "leaf",
    label: body.label?.trim() || `Literal ${row.family_id}`,
    variants: [{
      id: "literal",
      source_types: "any",
      fragments: [{ fragment: row.fragment, segments: [{ id: "form", literal: row.exact_text }] }],
      slots: {},
      before,
      after,
      output: { family_id: row.family_id, family_version: row.family_version, parameters: JSON.parse(row.parameters_json) as LeafStampVariant["output"]["parameters"] },
      allow_containment: [],
    }],
  };
  return proposeStamp(db, { definition, positives: [{ ability_version_id: row.ability_version_id, source_hash: row.source_hash, fragment: row.fragment, start_byte: row.start_byte, end_byte: row.end_byte, exact_text: row.exact_text }], counterexamples: [] });
}

function currentAbilities(db: DatabaseSync, ids?: readonly number[]): AbilityRow[] {
  if (ids && ids.length === 0) return [];
  if (!ids) return db.prepare("SELECT id, faction_id, ability_id, source_hash, source_text, source_type, fragments_json FROM abilities WHERE current = 1 ORDER BY id").all() as AbilityRow[];
  const selected = new Set(ids);
  return (db.prepare("SELECT id, faction_id, ability_id, source_hash, source_text, source_type, fragments_json FROM abilities WHERE current = 1 ORDER BY id").all() as AbilityRow[]).filter((row) => selected.has(row.id));
}

function candidateFor(row: StampRow, definition: Extract<StampDefinition, { kind: "leaf" }>, variant: LeafStampVariant, ability: AbilityRow, match: PatternMatch): Candidate {
  const instantiated = instantiateTemplate(variant.output.parameters, match.bindings);
  if (!instantiated || typeof instantiated !== "object" || Array.isArray(instantiated)) throw new StampError(422, `Stamp ${row.id}@${row.revision} emitted non-object parameters.`);
  const parameters = normalizeFingerprintParameters(variant.output.family_id, instantiated as Record<string, unknown>, variant.output.family_version);
  const sourceQualified = Object.values(parameters).filter((value): value is { source: string } => Boolean(value && typeof value === "object" && !Array.isArray(value) && "source" in value && typeof value.source === "string"));
  if (sourceQualified.some((value) => !match.exact_text.includes(value.source))) throw new StampError(422, `Stamp ${row.id}@${row.revision} emitted source-qualified data absent from its exact match.`);
  try { validateFamilySource(variant.output.family_id, parameters, match.exact_text); }
  catch (error) { throw new StampError(422, error instanceof Error ? error.message : "Stamp output is not grounded in its exact match."); }
  const role = familyRole(variant.output.family_id, variant.output.family_version);
  const fingerprintHash = hashJson({ family: variant.output.family_id, version: variant.output.family_version, parameters });
  const applicationIdentity = { matcher: STAMP_MATCHER_VERSION, stamp_id: row.id, revision: row.revision, ability_version_id: ability.id, fragment: match.fragment, start_byte: match.start_byte, end_byte: match.end_byte };
  const applicationId = `application_${hashJson(applicationIdentity)}`;
  const dependencies = { matcher_version: STAMP_MATCHER_VERSION, stamp: { id: row.id, revision: row.revision, definition_hash: row.definition_hash }, source_hash: ability.source_hash, leaf_annotation_ids: match.leaf_dependencies };
  return { stamp: row, definition, variant, ability, match, family_id: variant.output.family_id, family_version: variant.output.family_version, role, parameters, fingerprint_hash: fingerprintHash, application_id: applicationId, inputs_hash: hashJson({ dependencies, bindings: match.bindings, output: { family_id: variant.output.family_id, family_version: variant.output.family_version, parameters } }), dependencies, status: "eligible", reason_code: null, existing_annotation_id: null };
}

function candidatesForRows(db: DatabaseSync, rows: StampRow[], abilityIds?: readonly number[]): Candidate[] {
  const abilities = currentAbilities(db, abilityIds);
  const scan = createLeafScan();
  const raw: Candidate[] = [];
  for (const row of rows) {
    const definition = parsedDefinition(row);
    if (definition.kind !== "leaf") continue;
    for (const ability of abilities) {
      for (const variant of definition.variants) {
        for (const match of evaluateVariant(variant, ability, scan)) raw.push(candidateFor(row, definition, variant, ability, match));
      }
    }
  }
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of raw) {
    const group = grouped.get(candidate.application_id) ?? [];
    group.push(candidate);
    grouped.set(candidate.application_id, group);
  }
  const candidates: Candidate[] = [];
  for (const group of grouped.values()) {
    group.sort((left, right) => left.variant.id.localeCompare(right.variant.id) || hashJson(left.match.bindings).localeCompare(hashJson(right.match.bindings)));
    const representative = group[0]!;
    const parses = group.map((candidate) => ({
      variant_id: candidate.variant.id,
      bindings: candidate.match.bindings,
      output: { family_id: candidate.family_id, family_version: candidate.family_version, parameters: candidate.parameters },
    }));
    representative.dependencies = { ...representative.dependencies, equivalent_parses: parses };
    representative.inputs_hash = hashJson({ dependencies: representative.dependencies });
    if (new Set(group.map((candidate) => candidate.fingerprint_hash)).size > 1) {
      representative.status = "blocked";
      representative.reason_code = "SOURCE_AMBIGUITY";
    }
    candidates.push(representative);
  }
  return candidates;
}

function overlaps(left: Candidate, right: Candidate): boolean {
  return left.ability.id === right.ability.id && left.match.fragment === right.match.fragment && left.match.start_byte < right.match.end_byte && right.match.start_byte < left.match.end_byte;
}

function contains(left: Candidate, right: Candidate): boolean {
  return left.match.start_byte <= right.match.start_byte && left.match.end_byte >= right.match.end_byte;
}

function containmentApproved(left: Candidate, right: Candidate): boolean {
  if (left.role === right.role) return false;
  return left.variant.allow_containment.some((entry) => entry.other_family_id === right.family_id && entry.other_family_version === right.family_version && (entry.direction === "contains" ? contains(left, right) : contains(right, left))) || right.variant.allow_containment.some((entry) => entry.other_family_id === left.family_id && entry.other_family_version === left.family_version && (entry.direction === "contains" ? contains(right, left) : contains(left, right)));
}

function containmentApprovedWithHuman(
  candidate: Candidate,
  human: { start_byte: number; end_byte: number; role: string; family_id: string; family_version: number },
): boolean {
  if (candidate.role === human.role) return false;
  return candidate.variant.allow_containment.some((entry) =>
    entry.other_family_id === human.family_id
    && entry.other_family_version === human.family_version
    && (entry.direction === "contains"
      ? candidate.match.start_byte <= human.start_byte && candidate.match.end_byte >= human.end_byte
      : human.start_byte <= candidate.match.start_byte && human.end_byte >= candidate.match.end_byte));
}

function classifyCandidates(db: DatabaseSync, candidates: Candidate[]): void {
  const humanRows = db.prepare(`
    SELECT annotations.id, annotations.authority_kind, source_spans.ability_version_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, fingerprints.canonical_hash,
      semantic_families.role, fingerprints.family_id, fingerprints.family_version
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active' AND annotations.authority_kind = 'human'
  `).all() as Array<{ id: number; ability_version_id: number; fragment: string; start_byte: number; end_byte: number; canonical_hash: string; role: string; family_id: string; family_version: number }>;
  const rejectedRows = db.prepare(`
    SELECT source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      proposals.fingerprint_id FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.status IN ('rejected', 'corrected')
  `).all() as Array<{ ability_version_id: number; fragment: string; start_byte: number; end_byte: number; fingerprint_id: string | null }>;
  const auditedExclusions = db.prepare(`
    SELECT stamp_applications.id AS application_id,
      stamp_applications.ability_version_id,
      source_spans.fragment,
      source_spans.start_byte,
      source_spans.end_byte,
      fingerprints.canonical_hash
    FROM stamp_audit_decisions
    JOIN stamp_applications ON stamp_applications.id = stamp_audit_decisions.application_id
    LEFT JOIN annotations ON annotations.id = stamp_applications.annotation_id
    LEFT JOIN source_spans ON source_spans.id = COALESCE(stamp_applications.span_id, annotations.span_id)
    LEFT JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE stamp_audit_decisions.verdict = 'incorrect'
      AND stamp_audit_decisions.scope = 'occurrence'
  `).all() as Array<{
    application_id: string;
    ability_version_id: number;
    fragment: string | null;
    start_byte: number | null;
    end_byte: number | null;
    canonical_hash: string | null;
  }>;
  for (const candidate of candidates) {
    const excluded = auditedExclusions.some((audit) =>
      audit.application_id === candidate.application_id
      || (
        audit.ability_version_id === candidate.ability.id
        && audit.fragment === candidate.match.fragment
        && audit.start_byte === candidate.match.start_byte
        && audit.end_byte === candidate.match.end_byte
        && audit.canonical_hash === candidate.fingerprint_hash
      ));
    if (excluded) {
      candidate.status = "blocked";
      candidate.reason_code = "AUDIT_OCCURRENCE_INCORRECT";
    }
    if (candidate.status === "blocked") continue;
    const localHumans = humanRows.filter((human) => human.ability_version_id === candidate.ability.id && human.fragment === candidate.match.fragment && human.start_byte < candidate.match.end_byte && candidate.match.start_byte < human.end_byte);
    const exact = localHumans.find((human) => human.start_byte === candidate.match.start_byte && human.end_byte === candidate.match.end_byte && human.canonical_hash === candidate.fingerprint_hash);
    if (exact) {
      candidate.status = "already-satisfied";
      candidate.existing_annotation_id = exact.id;
      continue;
    }
    if (localHumans.some((human) => !containmentApprovedWithHuman(candidate, human))) {
      candidate.status = "blocked";
      candidate.reason_code = "HUMAN_CONFLICT";
      continue;
    }
    if (rejectedRows.some((rejection) =>
      rejection.ability_version_id === candidate.ability.id
      && rejection.fragment === candidate.match.fragment
      && rejection.start_byte === candidate.match.start_byte
      && rejection.end_byte === candidate.match.end_byte
      && (rejection.fingerprint_id === null || rejection.fingerprint_id === `fp_${candidate.fingerprint_hash}`)
    )) {
      candidate.status = "blocked";
      candidate.reason_code = "HUMAN_EXCLUDED";
    }
  }
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;
      if (left.status === "blocked" || right.status === "blocked") continue;
      if (!overlaps(left, right)) continue;
      const identical = left.match.start_byte === right.match.start_byte && left.match.end_byte === right.match.end_byte && left.role === right.role && left.fingerprint_hash === right.fingerprint_hash;
      if (identical || containmentApproved(left, right)) continue;
      if (left.status === "eligible") {
        left.status = "blocked";
        left.reason_code = "CONFLICT";
      }
      if (right.status === "eligible") {
        right.status = "blocked";
        right.reason_code = "CONFLICT";
      }
    }
  }
}

function allApprovedLeafRows(db: DatabaseSync): StampRow[] {
  return db.prepare("SELECT * FROM stamps WHERE status = 'approved' AND kind = 'leaf' ORDER BY id, revision").all() as StampRow[];
}

function previewCandidates(db: DatabaseSync, row: StampRow): Candidate[] {
  const allRows = allApprovedLeafRows(db).filter((candidate) => candidate.id !== row.id || candidate.revision !== row.revision);
  if (row.kind === "leaf") allRows.push(row);
  const candidates = candidatesForRows(db, allRows);
  classifyCandidates(db, candidates);
  return candidates.filter((candidate) => candidate.stamp.id === row.id && candidate.stamp.revision === row.revision);
}

function occurrenceView(candidate: Candidate): StampPreviewOccurrence {
  return {
    occurrence_id: candidate.application_id,
    ability_version_id: candidate.ability.id,
    source_hash: candidate.ability.source_hash,
    fragment: candidate.match.fragment,
    start_byte: candidate.match.start_byte,
    end_byte: candidate.match.end_byte,
    exact_text: candidate.match.exact_text,
    variant_id: candidate.variant.id,
    bindings: candidate.match.bindings,
    output: { family_id: candidate.family_id, family_version: candidate.family_version, parameters: candidate.parameters },
    status: candidate.status,
    reason_code: candidate.reason_code,
  };
}

function compositionPreviewOccurrences(
  db: DatabaseSync,
  row: StampRow,
  definition: Extract<StampDefinition, { kind: "composition" }>,
): { snapshots: StampPreviewOccurrence[]; combinations: Array<Record<string, unknown>> } {
  const snapshots: StampPreviewOccurrence[] = [];
  const combinations = new Map<string, Record<string, unknown>>();
  for (const ability of currentAbilities(db)) {
    const matches = compositionMatches(definition, ability, effectiveLeaves(db, ability.id));
    if (matches.length === 0) continue;
    const outputHashes = new Set(matches.map((match) => match.output_hash));
    const representative = matches.slice().sort((left, right) => left.variant.id.localeCompare(right.variant.id) || hashJson(left.bindings).localeCompare(hashJson(right.bindings)))[0]!;
    combinations.set(hashJson(representative.bindings), representative.bindings);
    const activeApplications = db.prepare(`
      SELECT variant_id, bindings_json FROM stamp_applications
      WHERE stamp_id = ? AND stamp_revision = ? AND ability_version_id = ? AND status = 'active'
    `).all(row.id, row.revision, ability.id) as Array<{ variant_id: string; bindings_json: string }>;
    const alreadySatisfied = outputHashes.size === 1 && activeApplications.some((application) =>
      application.variant_id === representative.variant.id
      && hashJson(JSON.parse(application.bindings_json)) === hashJson(representative.bindings));
    const output = {
      graph: instantiateTemplate(representative.variant.graph_template, representative.bindings),
      mechanics: representative.variant.mechanics_template === null ? null : instantiateTemplate(representative.variant.mechanics_template, representative.bindings),
    };
    const occurrenceId = `composition_${hashJson({ assembler: STAMP_ASSEMBLER_VERSION, stamp_id: row.id, revision: row.revision, ability_version_id: ability.id, output })}`;
    const fragments = abilityFragments(ability);
    snapshots.push({
      occurrence_id: occurrenceId,
      ability_version_id: ability.id,
      source_hash: ability.source_hash,
      fragment: fragments.length === 1 ? fragments[0]!.fragment : "__complete__",
      start_byte: 0,
      end_byte: Buffer.byteLength(ability.source_text, "utf8"),
      exact_text: ability.source_text,
      variant_id: representative.variant.id,
      bindings: representative.bindings,
      output,
      status: outputHashes.size > 1 ? "blocked" : alreadySatisfied ? "already-satisfied" : "eligible",
      reason_code: outputHashes.size > 1 ? "SOURCE_AMBIGUITY" : null,
    });
  }
  return { snapshots, combinations: [...combinations.values()] };
}

function challengeState(db: DatabaseSync, row: StampRow): unknown {
  if (row.challenge_run_id === null) return null;
  const run = db.prepare("SELECT id, input_hash, output_json, status FROM model_runs WHERE id = ?").get(row.challenge_run_id);
  return run ?? null;
}

type PreviewSnapshot = Omit<StampPreview, "examples" | "next_cursor"> & { occurrences: StampPreview["examples"] };

/**
 * Complete corpus-wide previews keyed by the persisted data epoch. Page turns and repeat views
 * slice a cached snapshot instead of rescanning; any row write anywhere advances the epoch, so a
 * stale snapshot is unreachable. Approval and suspension never read this cache.
 */
const PREVIEW_CACHE_LIMIT = 16;
const previewCache = new Map<string, PreviewSnapshot>();

export function previewStamp(db: DatabaseSync, stampId: string, revision: number, options: { cursor?: string } = {}): StampPreview {
  initializeWorkbench(db);
  const offset = pageOffset(options.cursor);
  return pagePreview(cachedPreviewSnapshot(db, stampId, revision), offset);
}

/**
 * The ability versions each eligible occurrence of a stamp preview would paint, from the same
 * cached corpus-wide snapshot the preview pages use. The work queue counts per-faction yield
 * with it without paging through examples.
 */
export function stampEligibleAbilities(db: DatabaseSync, stampId: string, revision: number): number[] {
  initializeWorkbench(db);
  return cachedPreviewSnapshot(db, stampId, revision).occurrences
    .filter((occurrence) => occurrence.status === "eligible")
    .map((occurrence) => occurrence.ability_version_id);
}

function cachedPreviewSnapshot(db: DatabaseSync, stampId: string, revision: number): PreviewSnapshot {
  const epoch = getDataEpoch(db);
  const key = JSON.stringify([epoch.instance_id, epoch.data_epoch, STAMP_MATCHER_VERSION, STAMP_ASSEMBLER_VERSION, stampId, revision]);
  let snapshot = previewCache.get(key);
  if (snapshot) {
    previewCache.delete(key);
  } else {
    snapshot = computePreviewSnapshot(db, stampId, revision);
    if (previewCache.size >= PREVIEW_CACHE_LIMIT) previewCache.delete(previewCache.keys().next().value!);
  }
  previewCache.set(key, snapshot);
  return snapshot;
}

/** Recompute a preview from persisted state, bypassing the snapshot cache (approval gates). */
function freshPreview(db: DatabaseSync, stampId: string, revision: number): StampPreview {
  return pagePreview(computePreviewSnapshot(db, stampId, revision), 0);
}

function pagePreview(snapshot: PreviewSnapshot, offset: number): StampPreview {
  const { occurrences, ...rest } = snapshot;
  // Cached snapshots are shared across requests, so callers receive copies.
  return structuredClone({
    ...rest,
    examples: occurrences.slice(offset, offset + PAGE_SIZE),
    next_cursor: offset + PAGE_SIZE < occurrences.length ? encodeOffset(offset + PAGE_SIZE) : null,
  });
}

function computePreviewSnapshot(db: DatabaseSync, stampId: string, revision: number): PreviewSnapshot {
  const row = requireStamp(db, stampId, revision);
  const definition = parsedDefinition(row);
  const positives = evidenceRows(db, stampId, revision, "positive");
  const counterexamples = evidenceRows(db, stampId, revision, "counterexample");
  validateEvidence(db, definition, positives, counterexamples);
  const candidates = definition.kind === "leaf" ? previewCandidates(db, row) : [];
  const compositionPreview = definition.kind === "composition" ? compositionPreviewOccurrences(db, row, definition) : null;
  const activeApplications = row.status === "approved" && candidates.length > 0
    ? new Map((db.prepare(`
      SELECT stamp_applications.id, stamp_applications.inputs_hash, fingerprints.canonical_hash
      FROM stamp_applications
      JOIN annotations ON annotations.id = stamp_applications.annotation_id AND annotations.status = 'active'
      JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
      JOIN abilities ON abilities.id = stamp_applications.ability_version_id AND abilities.current = 1
      WHERE stamp_applications.stamp_id = ? AND stamp_applications.stamp_revision = ?
        AND stamp_applications.status = 'active'
    `).all(stampId, revision) as Array<{ id: string; inputs_hash: string; canonical_hash: string }>)
      .map((application) => [application.id, application] as const))
    : null;
  const snapshots = compositionPreview?.snapshots ?? candidates.map((candidate) => {
    const occurrence = occurrenceView(candidate);
    const application = activeApplications?.get(candidate.application_id);
    if (occurrence.status === "eligible" && application?.inputs_hash === candidate.inputs_hash
      && application.canonical_hash === candidate.fingerprint_hash) occurrence.status = "already-satisfied";
    return occurrence;
  });
  const dependentDrafts = (db.prepare(`
    SELECT assembly_drafts.id FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    WHERE stamp_applications.stamp_id = ? AND stamp_applications.stamp_revision = ?
    ORDER BY assembly_drafts.id
  `).all(stampId, revision) as Array<{ id: string }>).map((draft) => draft.id);
  const previewState = {
    matcher_version: STAMP_MATCHER_VERSION,
    assembler_version: STAMP_ASSEMBLER_VERSION,
    stamp_id: stampId,
    revision,
    definition_hash: row.definition_hash,
    status: row.status,
    challenge: challengeState(db, row),
    positives,
    counterexamples,
    occurrences: snapshots,
    superseded: (db.prepare("SELECT id, revision, definition_hash, status FROM stamps WHERE id = ? AND revision <> ? ORDER BY revision").all(stampId, revision)),
    dependent_drafts: dependentDrafts,
  };
  const combinations = new Map<string, Record<string, unknown>>();
  for (const candidate of candidates) combinations.set(hashJson(candidate.parameters), candidate.parameters);
  for (const bindings of compositionPreview?.combinations ?? []) combinations.set(hashJson(bindings), bindings);
  return {
    stamp_id: stampId,
    revision,
    definition_hash: row.definition_hash,
    preview_hash: hashJson(previewState),
    totals: {
      eligible: snapshots.filter((candidate) => candidate.status === "eligible").length,
      already_satisfied: snapshots.filter((candidate) => candidate.status === "already-satisfied").length,
      blocked: snapshots.filter((candidate) => candidate.status === "blocked").length,
    },
    parameter_combinations: [...combinations.values()],
    occurrences: snapshots,
    counterexamples,
    dependent_drafts: dependentDrafts,
  };
}

function challengeRequired(definition: StampDefinition, row: StampRow): boolean {
  return row.model_run_id !== null || definition.kind === "composition" || definition.variants.some((variant) => Object.keys(variant.slots).length > 0);
}

/**
 * The single evaluation of the challenge gate. `assertChallengeClear` throws the blocker it
 * returns; `stampApprovalEligibility` reports it to the browser before a human clicks approve.
 */
function evaluateChallenge(
  db: DatabaseSync,
  row: StampRow,
  definition: StampDefinition,
  objectionResolution?: string,
): { review: StampChallengeReview; blocker: StampApprovalBlocker | null } {
  if (!challengeRequired(definition, row)) {
    return { review: { required: false, state: "not-required", verdict: null, run_id: null }, blocker: null };
  }
  const review = (state: StampChallengeState, verdict: StampChallengeReview["verdict"] = null): StampChallengeReview =>
    ({ required: true, state, verdict, run_id: row.challenge_run_id });
  const refuse = (
    code: StampApprovalBlocker["code"],
    status: number,
    message: string,
    nextAction: StampApprovalBlocker["next_action"],
    state: StampChallengeState,
    verdict: StampChallengeReview["verdict"] = null,
  ) => ({ review: review(state, verdict), blocker: { code, status, message, next_action: nextAction } });
  if (row.challenge_run_id === null) return refuse("CHALLENGE_MISSING", 422, "This stamp requires a distinct challenge run before approval.", "prepare-challenge", "missing");
  if (row.challenge_run_id === row.model_run_id) return refuse("CHALLENGE_SELF", 422, "The proposal and challenge must be distinct model runs.", "prepare-challenge", "self-challenge");
  const run = db.prepare("SELECT status, config_json, output_json FROM model_runs WHERE id = ?").get(row.challenge_run_id) as { status: string; config_json: string; output_json: string | null } | undefined;
  if (!run || run.status !== "completed" || run.output_json === null) return refuse("CHALLENGE_INCOMPLETE", 422, "The stamp challenge run is incomplete.", "prepare-challenge", "incomplete");
  const output = JSON.parse(run.output_json) as { definition_hash?: string; verdict?: string; items?: Array<{ item_id?: unknown; evidence_hash?: unknown; result?: { verdict?: unknown } }> };
  let definitionHash = output.definition_hash;
  let verdict = output.verdict;
  if (Array.isArray(output.items)) {
    const itemId = `${row.id}@${row.revision}`;
    const matches = output.items.filter((item) => item.item_id === itemId);
    if (matches.length !== 1) return refuse("CHALLENGE_NOT_PINNED", 422, "The challenge response must contain this stamp exactly once.", "prepare-challenge", "not-pinned");
    const config = JSON.parse(run.config_json) as { protocol?: unknown; items?: Array<{ item_id?: unknown; evidence_hash?: unknown; definition_hash?: unknown }> };
    const snapshots = Array.isArray(config.items) ? config.items.filter((item) => item.item_id === itemId) : [];
    if (config.protocol !== "round5c-work/v1" || snapshots.length !== 1) return refuse("CHALLENGE_NOT_PINNED", 422, "The challenge run is missing its pinned work snapshot.", "prepare-challenge", "not-pinned");
    if (matches[0]!.evidence_hash !== snapshots[0]!.evidence_hash) return refuse("CHALLENGE_NOT_PINNED", 409, "The challenge result is not pinned to its prepared evidence.", "prepare-challenge", "not-pinned");
    definitionHash = typeof snapshots[0]!.definition_hash === "string" ? snapshots[0]!.definition_hash : undefined;
    verdict = typeof matches[0]!.result?.verdict === "string" ? matches[0]!.result.verdict : undefined;
  }
  if (definitionHash !== row.definition_hash) return refuse("CHALLENGE_NOT_PINNED", 409, "The challenge result is not pinned to this definition.", "prepare-challenge", "not-pinned");
  if (verdict === "clear") return { review: review("clear", "clear"), blocker: null };
  if (verdict === "objection") {
    return objectionResolution?.trim()
      ? { review: review("objection", "objection"), blocker: null }
      : refuse("CHALLENGE_OBJECTION", 422, "The challenge is unresolved or objected without a human resolution.", "resolve-objection", "objection", "objection");
  }
  return refuse("CHALLENGE_UNRESOLVED", 422, "The challenge is unresolved or objected without a human resolution.", "prepare-challenge", "unresolved", "unresolved");
}

function assertChallengeClear(db: DatabaseSync, row: StampRow, definition: StampDefinition, objectionResolution: string | undefined): void {
  const { blocker } = evaluateChallenge(db, row, definition, objectionResolution);
  if (blocker) throw new StampError(blocker.status, blocker.message);
}

/** The unmet human-seed requirement, or null. Shared by approval and the browser's eligibility summary. */
function humanSeedGap(
  db: DatabaseSync,
  row: StampRow,
  definition: Extract<StampDefinition, { kind: "leaf" }>,
): string | null {
  const positives = evidenceRows(db, row.id, row.revision, "positive")
    .filter((evidence): evidence is StampSourceReference => !("synthetic" in evidence && evidence.synthetic));
  const humanConfirmation = db.prepare(`
    SELECT annotations.id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND annotations.authority_kind = 'human'
      AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte = ? AND source_spans.end_byte = ?
      AND fingerprints.canonical_hash = ?
    LIMIT 1
  `);
  for (const variant of definition.variants) {
    let covered = false;
    for (const evidence of positives) {
      const ability = currentAbilityForReference(db, evidence);
      for (const match of evaluateVariant(variant, ability)) {
        if (match.fragment !== evidence.fragment || match.start_byte !== evidence.start_byte || match.end_byte !== evidence.end_byte || match.exact_text !== evidence.exact_text) continue;
        const candidate = candidateFor(row, definition, variant, ability, match);
        if (humanConfirmation.get(ability.id, match.fragment, match.start_byte, match.end_byte, candidate.fingerprint_hash)) {
          covered = true;
          break;
        }
      }
      if (covered) break;
    }
    if (!covered) {
      return `Literal variant ${variant.id} requires an exact current human-confirmed positive or a pinned challenge run.`;
    }
  }
  return null;
}

function assertHumanSeedCoverage(
  db: DatabaseSync,
  row: StampRow,
  definition: Extract<StampDefinition, { kind: "leaf" }>,
): void {
  const gap = humanSeedGap(db, row, definition);
  if (gap) throw new StampError(422, gap);
}

function batch(
  db: DatabaseSync,
  operation: string,
  reviewer: string,
  reversedBatchId: string | null = null,
  metadata: Record<string, unknown> = {},
): string {
  const id = `batch_${randomUUID()}`;
  db.prepare(`
    INSERT INTO annotation_batches (
      id, operation, reviewer, created_at, metadata_json, reversed_batch_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, operation, reviewer, new Date().toISOString(), JSON.stringify(metadata), reversedBatchId);
  return id;
}

function member(db: DatabaseSync, batchId: string, kind: string, id: string | number): void {
  db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)").run(batchId, kind, String(id));
}

function approvalReviewer(db: DatabaseSync, row: StampRow): string {
  if (!row.approval_batch_id) throw new Error(`Approved stamp ${row.id}@${row.revision} has no approval batch.`);
  const receipt = db.prepare("SELECT reviewer FROM annotation_batches WHERE id = ?").get(row.approval_batch_id) as { reviewer: string } | undefined;
  if (!receipt) throw new Error(`Approved stamp ${row.id}@${row.revision} has no reviewer receipt.`);
  return receipt.reviewer;
}

function existingApplication(db: DatabaseSync, id: string): { id: string; inputs_hash: string; status: string; reason_code: string | null; annotation_id: number | null; span_id: number | null } | undefined {
  return db.prepare("SELECT id, inputs_hash, status, reason_code, annotation_id, span_id FROM stamp_applications WHERE id = ?").get(id) as { id: string; inputs_hash: string; status: string; reason_code: string | null; annotation_id: number | null; span_id: number | null } | undefined;
}

function persistApplication(db: DatabaseSync, candidate: Candidate, spanId: number | null, annotationId: number | null, status: "active" | "blocked", reasonCode: string | null, batchId: string | null): boolean {
  const now = new Date().toISOString();
  const existing = existingApplication(db, candidate.application_id);
  if (existing && existing.inputs_hash === candidate.inputs_hash && existing.status === status && existing.reason_code === reasonCode && existing.annotation_id === annotationId && existing.span_id === spanId) return false;
  db.prepare(`
    INSERT INTO stamp_applications (id, stamp_id, stamp_revision, ability_version_id, span_id, annotation_id, variant_id, inputs_hash, bindings_json, dependencies_json, status, reason_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET span_id = excluded.span_id, annotation_id = excluded.annotation_id,
      inputs_hash = excluded.inputs_hash, bindings_json = excluded.bindings_json,
      dependencies_json = excluded.dependencies_json, status = excluded.status,
      reason_code = excluded.reason_code, updated_at = excluded.updated_at
  `).run(candidate.application_id, candidate.stamp.id, candidate.stamp.revision, candidate.ability.id, spanId, annotationId, candidate.variant.id, candidate.inputs_hash, JSON.stringify(candidate.match.bindings), JSON.stringify(candidate.dependencies), status, reasonCode, now, now);
  if (batchId) member(db, batchId, status === "active" ? "stamp-application" : "stamp-application-blocked", candidate.application_id);
  return true;
}

function materializeCandidate(db: DatabaseSync, candidate: Candidate, applicationBatchId: string): { applied: boolean; satisfied: boolean; changed: boolean } {
  if (candidate.status === "already-satisfied") {
    const annotation = db.prepare("SELECT span_id FROM annotations WHERE id = ?").get(candidate.existing_annotation_id) as { span_id: number } | undefined;
    if (!annotation) throw new Error("Satisfied stamp candidate lost its annotation.");
    const changed = persistApplication(db, candidate, annotation.span_id, candidate.existing_annotation_id, "active", null, applicationBatchId);
    return { applied: false, satisfied: true, changed };
  }
  if (candidate.status === "blocked") {
    const spanId = insertSpan(
      db,
      candidate.ability.id,
      candidate.match.fragment,
      candidate.match.start_byte,
      candidate.match.end_byte,
      candidate.match.exact_text,
    );
    const changed = persistApplication(db, candidate, spanId, null, "blocked", candidate.reason_code, applicationBatchId);
    upsertEscalation(db, candidate.reason_code === "CONFLICT" ? "CONFLICT" : "SOURCE_AMBIGUITY", { stamp_id: candidate.stamp.id, revision: candidate.stamp.revision, variant_id: candidate.variant.id, role: candidate.role }, [{ ability_version_id: candidate.ability.id, source_hash: candidate.ability.source_hash, span: candidate.match }]);
    return { applied: false, satisfied: false, changed };
  }
  const spanId = insertSpan(db, candidate.ability.id, candidate.match.fragment, candidate.match.start_byte, candidate.match.end_byte, candidate.match.exact_text);
  const fingerprintId = validateFingerprint(db, candidate.family_id, candidate.parameters, candidate.family_version, candidate.match.exact_text);
  const shared = db.prepare(`
    SELECT annotations.id FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
      AND source_spans.fragment = ? AND source_spans.start_byte = ? AND source_spans.end_byte = ?
      AND annotations.fingerprint_id = ?
    ORDER BY annotations.authority_kind = 'human' DESC, annotations.id LIMIT 1
  `).get(candidate.ability.id, candidate.match.fragment, candidate.match.start_byte, candidate.match.end_byte, fingerprintId) as { id: number } | undefined;
  let annotationId = shared?.id ?? null;
  let changed = false;
  if (annotationId === null) {
    const inserted = db.prepare(`
      INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
      VALUES (?, ?, 'active', 'canonical-stamp', 'stamp', ?, ?, NULL, ?)
    `).run(spanId, fingerprintId, approvalReviewer(db, candidate.stamp), applicationBatchId, new Date().toISOString());
    annotationId = Number(inserted.lastInsertRowid);
    member(db, applicationBatchId, "annotation", annotationId);
    changed = true;
  }
  const applicationChanged = persistApplication(db, candidate, spanId, annotationId, "active", null, applicationBatchId);
  const proposalRows = db.prepare(`
    SELECT proposals.id, proposals.status FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.status IN ('pending', 'unresolved')
      AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte = ? AND source_spans.end_byte = ?
      AND (proposals.fingerprint_id IS NULL OR proposals.fingerprint_id = ?)
  `).all(candidate.ability.id, candidate.match.fragment, candidate.match.start_byte, candidate.match.end_byte, fingerprintId) as Array<{ id: number; status: string }>;
  for (const proposal of proposalRows) {
    db.prepare("UPDATE proposals SET status = 'superseded' WHERE id = ? AND status = ?").run(proposal.id, proposal.status);
    member(db, applicationBatchId, `stamp-proposal-superseded-${proposal.status}`, proposal.id);
    changed = true;
  }
  return { applied: applicationChanged, satisfied: false, changed: changed || applicationChanged };
}

type EscalationReason = "NEW_FORM" | "PARAMETER_BOUNDARY" | "CONFLICT" | "RELATION_GAP" | "COMPOSITION_GAP" | "DSL_GAP" | "SOURCE_AMBIGUITY" | "MODEL_ERROR" | "OVERSIZED" | "ENTITY_RESOLUTION";

function escalationDecisionKey(
  reasonCode: EscalationReason,
  question: Record<string, unknown>,
  members: Array<{ ability_version_id: number; source_hash: string; span?: PatternMatch; span_id?: number; draft_id?: string; gap_id?: number }>,
): string {
  const candidate = question.candidate_definition ?? question.options ?? null;
  const scope = {
    reason_code: reasonCode,
    stamp_id: question.stamp_id ?? null,
    revision: question.revision ?? null,
    variant_id: question.variant_id ?? null,
    path: question.path ?? question.unresolved_path ?? null,
    ...(question.source_form_hash === undefined ? {} : { source_form_hash: question.source_form_hash }),
    binding: question.binding ?? question.unresolved_binding ?? null,
    candidate_hash: candidate === null ? null : hashJson(candidate),
    draft_id: question.draft_id ?? null,
    audit_application_id: question.audit_application_id ?? null,
    item_id: question.item_id ?? null,
  };
  const groupable = Object.entries(scope).some(([key, value]) => key !== "reason_code" && value !== null);
  return hashJson(groupable ? scope : {
    ...scope,
    question_hash: hashJson(question),
    source_scope: members.map((member) => ({
      ability_version_id: member.ability_version_id,
      source_hash: member.source_hash,
      draft_id: member.draft_id ?? null,
      gap_id: member.gap_id ?? null,
    })).sort((left, right) => left.ability_version_id - right.ability_version_id || left.source_hash.localeCompare(right.source_hash)),
  });
}

function upsertEscalation(db: DatabaseSync, reasonCode: EscalationReason, question: Record<string, unknown>, members: Array<{ ability_version_id: number; source_hash: string; span?: PatternMatch; span_id?: number; draft_id?: string; gap_id?: number }>): string {
  const decisionKey = escalationDecisionKey(reasonCode, question, members);
  const escalationId = `escalation_${decisionKey}`;
  const now = new Date().toISOString();
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO escalations (id, decision_key, reason_code, question_json, options_json, state, decision_batch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', 'open', NULL, ?, ?)
  `).run(escalationId, decisionKey, reasonCode, JSON.stringify(question), now, now);
  const insert = db.prepare(`
    INSERT INTO escalation_members (escalation_id, member_id, ability_version_id, source_hash, evidence_hash, span_id, draft_id, gap_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(escalation_id, member_id) DO UPDATE SET
      evidence_hash = excluded.evidence_hash,
      span_id = excluded.span_id,
      draft_id = excluded.draft_id,
      gap_id = excluded.gap_id,
      status = 'active'
    WHERE escalation_members.evidence_hash <> excluded.evidence_hash
      OR escalation_members.span_id IS NOT excluded.span_id
      OR escalation_members.draft_id IS NOT excluded.draft_id
      OR escalation_members.gap_id IS NOT excluded.gap_id
      OR escalation_members.status <> 'active'
  `);
  let evidenceChanged = false;
  for (const item of members) {
    const spanId = item.span
      ? insertSpan(db, item.ability_version_id, item.span.fragment, item.span.start_byte, item.span.end_byte, item.span.exact_text)
      : item.span_id ?? null;
    const evidenceHash = hashJson({ ability_version_id: item.ability_version_id, source_hash: item.source_hash, span: item.span ?? spanId, draft_id: item.draft_id ?? null, gap_id: item.gap_id ?? null });
    const memberChanged = insert.run(escalationId, evidenceHash, item.ability_version_id, item.source_hash, evidenceHash, spanId, item.draft_id ?? null, item.gap_id ?? null, now).changes > 0;
    evidenceChanged = evidenceChanged || memberChanged;
  }
  if (inserted.changes === 0) {
    const existing = db.prepare("SELECT question_json FROM escalations WHERE id = ?").get(escalationId) as { question_json: string };
    const previousQuestion = JSON.parse(existing.question_json) as Record<string, unknown>;
    const nextQuestion = previousQuestion.revision_request !== undefined && question.revision_request === undefined
      ? { ...question, revision_request: previousQuestion.revision_request }
      : question;
    const questionChanged = hashJson(previousQuestion) !== hashJson(nextQuestion);
    if (questionChanged) {
      db.prepare("UPDATE escalations SET question_json = ?, state = 'open', decision_batch_id = NULL, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(nextQuestion), now, escalationId);
    } else if (evidenceChanged) {
      db.prepare("UPDATE escalations SET state = 'open', decision_batch_id = NULL, updated_at = ? WHERE id = ? AND state <> 'open'").run(now, escalationId);
    }
  }
  return escalationId;
}

export function createEscalation(db: DatabaseSync, reasonCode: Parameters<typeof upsertEscalation>[1], question: Record<string, unknown>, members: Parameters<typeof upsertEscalation>[3]): string {
  return upsertEscalation(db, reasonCode, question, members);
}

function reconcileLeafGapEscalations(db: DatabaseSync, abilityVersionIds?: readonly number[]): void {
  if (abilityVersionIds?.length === 0) return;
  const rows = db.prepare(`
    SELECT gaps.id AS gap_id, gaps.ability_version_id, abilities.source_hash,
      proposals.span_id, proposals.role, proposals.reason_json, proposals.status, source_spans.exact_text
    FROM gaps
    JOIN abilities ON abilities.id = gaps.ability_version_id
    JOIN proposals ON proposals.id = gaps.proposal_id
    JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE gaps.type = 'LEAF_GAP' AND gaps.status = 'open'
      AND abilities.current = 1 AND proposals.status IN ('unresolved', 'pending')
    ORDER BY gaps.id
  `).all() as Array<{
    gap_id: number; ability_version_id: number; source_hash: string;
    span_id: number; role: string; reason_json: string; exact_text: string; status: string;
  }>;
  const selected = abilityVersionIds === undefined ? null : new Set(abilityVersionIds);
  const candidateFor = db.prepare(`
    SELECT candidate_id FROM family_candidate_evidence
    WHERE span_id = ? AND verdict = 'suggested' AND revoked_at IS NULL ORDER BY id LIMIT 1
  `);
  for (const row of rows) {
    if (selected && !selected.has(row.ability_version_id)) continue;
    const reason = JSON.parse(row.reason_json) as { kind?: string; type?: string; span_status?: string; implicit?: boolean };
    // Manual novel/ambiguous decisions, a model's NOVEL leaf, and a model's explicit UNRESOLVED
    // claim each need a human decision; a merely unreported (implicit) region does not.
    const novel = (row.status === "unresolved" && reason.kind === "novel")
      || (row.status === "pending" && reason.type === "semantic-span" && reason.span_status === "NOVEL");
    const ambiguous = row.status === "unresolved" && (reason.kind === "ambiguous"
      || (reason.type === "semantic-span" && reason.span_status === "UNRESOLVED")
      || (reason.type === "unresolved-region" && reason.implicit !== true));
    if (!novel && !ambiguous) continue;
    const candidate = novel ? candidateFor.get(row.span_id) as { candidate_id: number } | undefined : undefined;
    upsertEscalation(db, novel ? "NEW_FORM" : "SOURCE_AMBIGUITY", {
      path: "unresolved-leaf",
      source_form_hash: hashJson({ surface: normalizedSurface(row.exact_text), role: row.role }),
      question: novel
        ? "Which reusable leaf rule expresses this source form?"
        : "Which interpretation does this ambiguous source form support?",
      ...(candidate ? { family_candidate_id: candidate.candidate_id } : {}),
    }, [{
      ability_version_id: row.ability_version_id,
      source_hash: row.source_hash,
      span_id: row.span_id,
      gap_id: row.gap_id,
    }]);
  }
}

function applyApprovedLeafStamps(db: DatabaseSync, abilityVersionIds: readonly number[] | undefined): Omit<ApplicationReport, "composition"> {
  const candidates = candidatesForRows(db, allApprovedLeafRows(db), abilityVersionIds);
  classifyCandidates(db, candidates);
  const existingActive = db.prepare(`
    SELECT stamp_applications.id, stamp_applications.ability_version_id, stamp_applications.annotation_id
    FROM stamp_applications
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    WHERE stamp_applications.status = 'active' AND stamps.kind = 'leaf'
  `).all() as Array<{ id: string; ability_version_id: number; annotation_id: number | null }>;
  const activeDerived = db.prepare(`
    SELECT annotations.id, source_spans.ability_version_id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.authority_kind = 'stamp' AND annotations.status = 'active'
  `).all() as Array<{ id: number; ability_version_id: number }>;
  const affectedAnnotations = new Set([
    ...existingActive.flatMap((application) => application.annotation_id === null ? [] : [application.annotation_id]),
    ...activeDerived.filter((annotation) => !abilityVersionIds || abilityVersionIds.includes(annotation.ability_version_id)).map((annotation) => annotation.id),
  ]);
  const currentIds = new Set(candidates.map((candidate) => candidate.application_id));
  let stale = 0;
  for (const application of existingActive) {
    if (abilityVersionIds && !abilityVersionIds.includes(application.ability_version_id)) continue;
    if (!currentIds.has(application.id)) stale += Number(db.prepare("UPDATE stamp_applications SET status = 'stale', reason_code = 'NO_LONGER_MATCHES', updated_at = ? WHERE id = ? AND status = 'active'").run(new Date().toISOString(), application.id).changes);
  }
  if (candidates.length === 0) {
    const retracted = retractUnsupportedStampAnnotations(db, affectedAnnotations, "STAMP_APPLICATION_CHANGED");
    stale += retracted.applications;
    const changed = stale > 0 || retracted.annotations > 0 || retracted.applications > 0 || retracted.drafts > 0;
    return { applied: 0, already_satisfied: 0, blocked: 0, stale, changed };
  }
  const applicationBatchId = batch(db, "stamp-application", "deterministic-stamp-engine");
  let applied = 0;
  let alreadySatisfied = 0;
  let blocked = 0;
  let changed = stale > 0;
  for (const candidate of candidates) {
    const result = materializeCandidate(db, candidate, applicationBatchId);
    if (candidate.status === "blocked") blocked += 1;
    else if (result.satisfied) alreadySatisfied += 1;
    else if (result.applied) applied += 1;
    changed ||= result.changed;
  }
  const retracted = retractUnsupportedStampAnnotations(db, affectedAnnotations, "STAMP_APPLICATION_CHANGED");
  stale += retracted.applications;
  changed ||= retracted.annotations > 0 || retracted.applications > 0 || retracted.drafts > 0;
  if (!changed) db.prepare("DELETE FROM annotation_batches WHERE id = ?").run(applicationBatchId);
  return { applied, already_satisfied: alreadySatisfied, blocked, stale, changed };
}

export function applyStamps(db: DatabaseSync, options: { ability_version_ids?: number[]; bump_revision?: boolean } = {}): ApplicationReport {
  initializeWorkbench(db);
  return withTransaction(db, () => {
    const leaf = applyApprovedLeafStamps(db, options.ability_version_ids);
    const composition = applyCompositionStamps(db, { ability_version_ids: options.ability_version_ids, create_escalation: (reasonCode, question, members) => upsertEscalation(db, reasonCode, question, members) });
    reconcileLeafGapEscalations(db, options.ability_version_ids);
    if (options.bump_revision !== false && (leaf.changed || composition.changed)) bumpWorkbenchRevision(db);
    return { ...leaf, composition };
  });
}

export function approveStamp(db: DatabaseSync, stampId: string, revision: number, body: { reviewer: string; preview_hash: string; objection_resolution?: string }): { approval_batch_id: string; applied: number; already_satisfied: number; blocked: number } {
  if (!body.reviewer?.trim() || !body.preview_hash?.trim()) throw new StampError(422, "reviewer and preview_hash are required.");
  return withTransaction(db, () => {
    const row = requireStamp(db, stampId, revision);
    if (row.status !== "proposed" && row.status !== "suspended") throw new StampError(409, "Only proposed or suspended stamps can be approved.");
    const preview = freshPreview(db, stampId, revision);
    if (preview.preview_hash !== body.preview_hash) throw new StampError(409, "Stamp preview changed; review updated evidence.");
    const definition = parsedDefinition(row);
    assertChallengeClear(db, row, definition, body.objection_resolution);
    if (definition.kind === "leaf" && !challengeRequired(definition, row)) {
      assertHumanSeedCoverage(db, row, definition);
    }
    const priorApproved = db.prepare("SELECT revision FROM stamps WHERE id = ? AND status = 'approved' ORDER BY revision")
      .all(stampId) as Array<{ revision: number }>;
    const approvalBatchId = batch(
      db,
      "stamp-approval",
      body.reviewer.trim(),
      null,
      body.objection_resolution?.trim()
        ? { objection_resolution: body.objection_resolution.trim() }
        : {},
    );
    db.prepare("UPDATE stamps SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'approved'").run(new Date().toISOString(), stampId);
    const changed = db.prepare("UPDATE stamps SET status = 'approved', approval_batch_id = ?, updated_at = ? WHERE id = ? AND revision = ? AND status IN ('proposed', 'suspended')").run(approvalBatchId, new Date().toISOString(), stampId, revision);
    if (changed.changes !== 1) throw new StampError(409, "Stamp state changed during approval.");
    member(db, approvalBatchId, "stamp-approved", `${stampId}@${revision}`);
    for (const prior of priorApproved) {
      invalidateStampRevision(db, stampId, prior.revision, "STAMP_SUPERSEDED");
      member(db, approvalBatchId, "stamp-superseded", `${stampId}@${prior.revision}`);
    }
    const report = applyApprovedLeafStamps(db, undefined);
    const composition = applyCompositionStamps(db, { create_escalation: (reasonCode, question, members) => upsertEscalation(db, reasonCode, question, members) });
    bumpWorkbenchRevision(db);
    return { approval_batch_id: approvalBatchId, applied: report.applied + composition.proposed, already_satisfied: report.already_satisfied, blocked: report.blocked + composition.blocked };
  });
}

export function suspendStamp(db: DatabaseSync, stampId: string, revision: number, body: { reviewer: string; preview_hash: string; reason: string }): { batch_id: string; invalidated: { applications: number; drafts: number; annotations: number }; affected_published_entries: AffectedPublishedEntry[] } {
  if (!body.reviewer?.trim() || !body.preview_hash?.trim() || !body.reason?.trim()) throw new StampError(422, "reviewer, preview_hash, and reason are required.");
  return withTransaction(db, () => {
    const row = requireStamp(db, stampId, revision);
    if (row.status !== "approved") throw new StampError(409, "Only an approved stamp can be suspended.");
    const preview = freshPreview(db, stampId, revision);
    if (preview.preview_hash !== body.preview_hash) throw new StampError(409, "Stamp preview changed; review updated evidence.");
    const affected = affectedPublishedEntries(db, stampId, revision);
    const batchId = batch(db, "stamp-suspension", body.reviewer.trim(), null, { reason: body.reason.trim() });
    db.prepare("UPDATE stamps SET status = 'suspended', updated_at = ? WHERE id = ? AND revision = ? AND status = 'approved'").run(new Date().toISOString(), stampId, revision);
    const invalidated = invalidateStampRevision(db, stampId, revision, "STAMP_SUSPENDED");
    member(db, batchId, "stamp-suspended", `${stampId}@${revision}`);
    applyStamps(db, { bump_revision: false });
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, invalidated, affected_published_entries: affected };
  });
}
export function rejectStamp(db: DatabaseSync, stampId: string, revision: number, body: { reviewer: string; definition_hash: string; reason: string }): { batch_id: string } {
  if (!body.reviewer?.trim() || !body.definition_hash?.trim() || !body.reason?.trim()) throw new StampError(422, "reviewer, definition_hash, and reason are required.");
  return withTransaction(db, () => {
    const row = requireStamp(db, stampId, revision);
    if (row.status !== "proposed") throw new StampError(409, "Only a proposed stamp can be rejected; suspend approved authority.");
    if (row.definition_hash !== body.definition_hash) throw new StampError(409, "Stamp definition changed before rejection.");
    const batchId = batch(db, "stamp-rejection", body.reviewer.trim(), null, { reason: body.reason.trim() });
    db.prepare("UPDATE stamps SET status = 'rejected', updated_at = ? WHERE id = ? AND revision = ? AND status = 'proposed'").run(new Date().toISOString(), stampId, revision);
    member(db, batchId, "stamp-rejected", `${stampId}@${revision}`);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId };
  });
}

export function reconcileWorkbench(db: DatabaseSync, options: { ability_version_ids?: number[]; refresh_lexical?: () => unknown; bump_revision?: boolean } = {}): ApplicationReport {
  return withTransaction(db, () => {
    const report = applyStamps(db, { ability_version_ids: options.ability_version_ids, bump_revision: false });
    const lexical = options.refresh_lexical?.();
    const lexicalChanged = Boolean(lexical && typeof lexical === "object" && "created" in lexical && typeof lexical.created === "number" && lexical.created > 0);
    if (options.bump_revision !== false && (report.changed || lexicalChanged)) bumpWorkbenchRevision(db);
    return report;
  });
}

export function listStamps(db: DatabaseSync, options: { status?: string; cursor?: string } = {}): { items: Array<Record<string, unknown>>; next_cursor: string | null; total: number } {
  const allowed: Record<string, true> = { proposed: true, approved: true, rejected: true, suspended: true, superseded: true };
  if (options.status && !allowed[options.status]) throw new StampError(422, "Unknown stamp status filter.");
  const status = options.status ?? null;
  let boundary: { created_at: string; id: string; revision: number } | null = null;
  let snapshotRowid = Number((db.prepare("SELECT coalesce(max(rowid), 0) AS value FROM stamps").get() as { value: number }).value);
  let snapshotTotal: number | null = null;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor, "Stamp");
    if (
      decoded.kind !== "stamps"
      || decoded.status !== status
      || typeof decoded.created_at !== "string"
      || typeof decoded.id !== "string"
      || !Number.isSafeInteger(decoded.revision)
      || Number(decoded.revision) < 1
      || !Number.isSafeInteger(decoded.snapshot_rowid)
      || Number(decoded.snapshot_rowid) < 0
      || !Number.isSafeInteger(decoded.total)
      || Number(decoded.total) < 0
    ) throw new StampError(422, "Stamp cursor is malformed.");
    boundary = { created_at: decoded.created_at, id: decoded.id, revision: Number(decoded.revision) };
    snapshotRowid = Number(decoded.snapshot_rowid);
    snapshotTotal = Number(decoded.total);
  }
  const filters: string[] = ["rowid <= ?"];
  const parameters: Array<string | number> = [snapshotRowid];
  if (status !== null) {
    filters.push("status = ?");
    parameters.push(status);
  }
  if (boundary !== null) {
    filters.push("(created_at < ? OR (created_at = ? AND (id > ? OR (id = ? AND revision > ?))))");
    parameters.push(boundary.created_at, boundary.created_at, boundary.id, boundary.id, boundary.revision);
  }
  const rows = db.prepare(`
    SELECT * FROM stamps
    ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id, revision
    LIMIT ${PAGE_SIZE + 1}
  `).all(...parameters) as StampRow[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  const total = snapshotTotal ?? Number((db.prepare(`
    SELECT count(*) AS total FROM stamps
    WHERE rowid <= ? ${status === null ? "" : "AND status = ?"}
  `).get(snapshotRowid, ...(status === null ? [] : [status])) as { total: number }).total);
  return {
    items: page.map((row) => ({ ...row, definition: parsedDefinition(row), definition_json: undefined })),
    next_cursor: rows.length > PAGE_SIZE && last
      ? encodeCursor({
        kind: "stamps",
        status,
        created_at: last.created_at,
        id: last.id,
        revision: last.revision,
        snapshot_rowid: snapshotRowid,
        total,
      })
      : null,
    total,
  };
}

/**
 * Why approval is or is not currently possible, from the same gates `approveStamp` enforces.
 * The browser renders this before a reviewer clicks, so a refusal is never the first signal.
 */
export function stampApprovalEligibility(db: DatabaseSync, stampId: string, revision: number): StampApprovalEligibility {
  const row = requireStamp(db, stampId, revision);
  const definition = parsedDefinition(row);
  const { review, blocker } = evaluateChallenge(db, row, definition);
  if (blocker) return { approvable: false, blocker, challenge: review };
  if (row.status !== "proposed" && row.status !== "suspended") {
    return {
      approvable: false,
      blocker: { code: "STATE", status: 409, message: `Only proposed or suspended stamps can be approved; this revision is ${row.status}.`, next_action: "none" },
      challenge: review,
    };
  }
  if (definition.kind === "leaf" && !challengeRequired(definition, row)) {
    const gap = humanSeedGap(db, row, definition);
    if (gap) {
      return {
        approvable: false,
        blocker: { code: "HUMAN_SEED", status: 422, message: gap, next_action: "seed-occurrence" },
        challenge: review,
      };
    }
  }
  return { approvable: true, blocker: null, challenge: review };
}

export function getStamp(db: DatabaseSync, stampId: string, revision: number): Record<string, unknown> {
  const row = requireStamp(db, stampId, revision);
  return {
    ...row,
    definition: parsedDefinition(row),
    definition_json: undefined,
    positives: evidenceRows(db, stampId, revision, "positive"),
    counterexamples: evidenceRows(db, stampId, revision, "counterexample"),
    approval_eligibility: stampApprovalEligibility(db, stampId, revision),
  };
}

export function escalationAssemblableImpact(db: DatabaseSync, escalationId: string): number | null {
  const row = db.prepare("SELECT question_json FROM escalations WHERE id = ?").get(escalationId) as { question_json: string } | undefined;
  if (!row) throw new StampError(404, `Unknown escalation ${escalationId}.`);
  const question = JSON.parse(row.question_json) as Record<string, unknown>;
  if (typeof question.stamp_id !== "string" || !Number.isSafeInteger(question.revision) || Number(question.revision) < 1) return null;
  const stamp = db.prepare("SELECT kind, status FROM stamps WHERE id = ? AND revision = ?")
    .get(question.stamp_id, Number(question.revision)) as { kind: string; status: string } | undefined;
  if (!stamp || stamp.kind !== "composition" || stamp.status !== "approved") return null;
  const result = db.prepare(`
    SELECT count(DISTINCT escalation_members.ability_version_id) AS total
    FROM escalation_members
    JOIN abilities ON abilities.id = escalation_members.ability_version_id
      AND abilities.current = 1
      AND abilities.source_hash = escalation_members.source_hash
    JOIN stamp_applications ON stamp_applications.ability_version_id = escalation_members.ability_version_id
      AND stamp_applications.stamp_id = ?
      AND stamp_applications.stamp_revision = ?
      AND stamp_applications.status IN ('active', 'blocked')
    WHERE escalation_members.escalation_id = ?
      AND escalation_members.status = 'active'
  `).get(question.stamp_id, Number(question.revision), escalationId) as { total: number };
  return Number(result.total);
}

type EscalationListRow = Record<string, unknown> & {
  id: string;
  reason_code: string;
  question_json: string;
  options_json: string;
  occurrence_count: number;
  assemblable_abilities: number | null;
};

function escalationRows(db: DatabaseSync, status: "open" | "deferred" | "resolved"): EscalationListRow[] {
  const rows = db.prepare(`
    SELECT escalations.*, count(escalation_members.member_id) AS occurrence_count
    FROM escalations
    LEFT JOIN escalation_members ON escalation_members.escalation_id = escalations.id
      AND escalation_members.status = 'active'
    WHERE escalations.state = ?
    GROUP BY escalations.id
    HAVING count(escalation_members.member_id) > 0
  `).all(status) as Array<Record<string, unknown> & {
    id: string;
    reason_code: string;
    question_json: string;
    options_json: string;
    occurrence_count: number;
  }>;
  return rows.map((row) => ({ ...row, occurrence_count: Number(row.occurrence_count), assemblable_abilities: escalationAssemblableImpact(db, row.id) }))
    .sort((left, right) =>
      Number(left.reason_code !== "CONFLICT") - Number(right.reason_code !== "CONFLICT")
      || Number(left.assemblable_abilities === null) - Number(right.assemblable_abilities === null)
      || (right.assemblable_abilities ?? -1) - (left.assemblable_abilities ?? -1)
      || right.occurrence_count - left.occurrence_count
      || left.id.localeCompare(right.id));
}

/** How many member sources an escalation card shows; `occurrence_count` still reports all. */
const ESCALATION_SOURCE_LIMIT = 5;

export function listEscalations(db: DatabaseSync, options: { status?: "open" | "deferred" | "resolved"; cursor?: string } = {}): { items: Array<Record<string, unknown>>; next_cursor: string | null; total: number } {
  const status = options.status ?? "open";
  const rows = escalationRows(db, status);
  let orderedIds = rows.map((row) => row.id);
  let total = rows.length;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor, "Escalation");
    if (
      decoded.kind !== "escalations"
      || decoded.status !== status
      || !Array.isArray(decoded.remaining_ids)
      || decoded.remaining_ids.some((id) => typeof id !== "string")
      || new Set(decoded.remaining_ids).size !== decoded.remaining_ids.length
      || !Number.isSafeInteger(decoded.total)
      || Number(decoded.total) < 0
    ) throw new StampError(422, "Escalation cursor is malformed.");
    orderedIds = decoded.remaining_ids as string[];
    total = Number(decoded.total);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const available = orderedIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const page = available.slice(0, PAGE_SIZE);
  const consumed = new Set(page.map((row) => row.id));
  const remaining = orderedIds.filter((id) => byId.has(id) && !consumed.has(id));
  const sources = db.prepare(`
    SELECT abilities.id AS ability_version_id, abilities.faction_id, abilities.ability_id, abilities.name,
      abilities.source_text, source_spans.exact_text AS span_text
    FROM escalation_members
    JOIN abilities ON abilities.id = escalation_members.ability_version_id
      AND abilities.current = 1 AND abilities.source_hash = escalation_members.source_hash
    LEFT JOIN source_spans ON source_spans.id = escalation_members.span_id
    WHERE escalation_members.escalation_id = ? AND escalation_members.status = 'active'
    ORDER BY abilities.faction_id, abilities.ability_id, escalation_members.member_id
    LIMIT ${ESCALATION_SOURCE_LIMIT}
  `);
  const items = page.map(({ question_json, options_json, ...row }) => ({
    ...row,
    question: JSON.parse(question_json),
    options: JSON.parse(options_json),
    // The complete sources behind the question, so a reviewer can decide without leaving the card.
    sources: sources.all(row.id),
  }));
  return {
    items,
    next_cursor: remaining.length > 0
      ? encodeCursor({ kind: "escalations", status, remaining_ids: remaining, total })
      : null,
    total,
  };
}

function escalationEvidenceSnapshot(db: DatabaseSync, escalationId: string): Record<string, unknown> {
  const row = db.prepare(`
    SELECT state, decision_key, question_json, options_json
    FROM escalations WHERE id = ?
  `).get(escalationId) as { state: string; decision_key: string; question_json: string; options_json: string } | undefined;
  if (!row) throw new StampError(404, `Unknown escalation ${escalationId}.`);
  return {
    decision_key: row.decision_key,
    state: row.state,
    question: JSON.parse(row.question_json),
    options: JSON.parse(row.options_json),
    members: db.prepare(`
      SELECT member_id, evidence_hash, status
      FROM escalation_members WHERE escalation_id = ? ORDER BY member_id
    `).all(escalationId),
  };
}

export function decideEscalation(db: DatabaseSync, escalationId: string, body: { reviewer: string; evidence_hash: string; action: unknown; note?: string }): { batch_id: string; state: string } {
  if (!body.reviewer?.trim() || !body.evidence_hash?.trim()) throw new StampError(422, "reviewer and evidence_hash are required.");
  const action = body.action;
  if (action !== "defer" && action !== "reopen" && action !== "request-revision") {
    throw new StampError(422, "Escalation action must be defer, reopen, or request-revision.");
  }
  if (action === "request-revision" && !body.note?.trim()) throw new StampError(422, "request-revision requires a nonempty note.");
  return withTransaction(db, () => {
    const row = db.prepare("SELECT state, question_json FROM escalations WHERE id = ?").get(escalationId) as { state: string; question_json: string } | undefined;
    if (!row) throw new StampError(404, `Unknown escalation ${escalationId}.`);
    if (hashJson(escalationEvidenceSnapshot(db, escalationId)) !== body.evidence_hash) throw new StampError(409, "Escalation evidence changed; reload before deciding.");
    if (action === "defer" && row.state !== "open") throw new StampError(409, "Only an open escalation can be deferred.");
    if (action === "reopen" && row.state !== "deferred") throw new StampError(409, "Only a deferred escalation can be reopened.");
    if (row.state === "resolved") throw new StampError(409, "A resolved escalation cannot be changed by this action.");
    const batchId = batch(db, `escalation-${action}`, body.reviewer.trim(), null, body.note?.trim() ? { note: body.note.trim() } : {});
    const state = action === "defer" ? "deferred" : "open";
    const question = JSON.parse(row.question_json) as Record<string, unknown>;
    if (action === "request-revision") question.revision_request = body.note!.trim();
    db.prepare("UPDATE escalations SET state = ?, question_json = ?, decision_batch_id = ?, updated_at = ? WHERE id = ?").run(state, JSON.stringify(question), batchId, new Date().toISOString(), escalationId);
    member(db, batchId, `escalation-${action}`, escalationId);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, state };
  });
}

export function escalationEvidenceHash(db: DatabaseSync, escalationId: string): string {
  return hashJson(escalationEvidenceSnapshot(db, escalationId));
}

type StampAuditApplication = {
  id: string;
  inputs_hash: string;
  variant_id: string;
  bindings_json: string;
  dependencies_json: string;
  ability_version_id: number;
  annotation_id: number | null;
  source_hash: string;
  source_text: string;
  fragments_json: string;
  faction_id: string;
  ability_id: string;
  fragment: string | null;
  start_byte: number | null;
  end_byte: number | null;
  exact_text: string | null;
};

type StampAuditCoverage = {
  applications: number;
  selected: number;
  strata: number;
  variants: { observed: number; represented: number };
  enum_combinations: { observed: number; represented: number };
  numeric_extrema: { observed: number; represented: number };
  neighboring_contexts: { observed: number; represented: number };
  additional: number;
};

export type StampAuditItem = {
  application_id: string;
  inputs_hash: string;
  variant_id: string;
  bindings: Record<string, unknown>;
  dependencies: Record<string, unknown>;
  dependency_hash: string;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  neighboring_context: { before: string; after: string; signature: string };
  strata: string[];
  latest_audit: {
    verdict: "correct" | "incorrect" | "uncertain";
    scope: "occurrence" | "rule" | null;
    created_at: string;
    reviewer: string;
  } | null;
};

export type StampAuditPage = {
  stamp_id: string;
  revision: number;
  audit_hash: string;
  items: StampAuditItem[];
  coverage: StampAuditCoverage;
  next_cursor: string | null;
};

export type AffectedPublishedEntry = {
  publication_batch_id: string;
  faction_id: string;
  ability_id: string;
  draft_id: string;
};

function auditCursorOffset(cursor: string | undefined, auditHash: string): number {
  if (cursor === undefined) return 0;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      decoded && typeof decoded === "object" && !Array.isArray(decoded)
      && "audit_hash" in decoded && decoded.audit_hash === auditHash
      && "offset" in decoded && typeof decoded.offset === "number"
      && Number.isSafeInteger(decoded.offset) && decoded.offset >= 0
    ) return decoded.offset;
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded) && "audit_hash" in decoded) {
      throw new StampError(409, "Stamp audit evidence changed; restart the audit sample.");
    }
  } catch (error) {
    if (error instanceof StampError) throw error;
  }
  throw new StampError(422, "Stamp audit cursor is malformed.");
}

function encodeAuditCursor(auditHash: string, offset: number): string {
  return Buffer.from(JSON.stringify({ audit_hash: auditHash, offset }), "utf8").toString("base64url");
}

function contextForAudit(application: StampAuditApplication): {
  before: string;
  after: string;
  signature: string;
} {
  if (
    application.fragment === null
    || application.start_byte === null
    || application.end_byte === null
  ) {
    const fragments = parseStoredFragments(application.fragments_json).map((fragment) => fragment.fragment);
    return {
      before: "",
      after: "",
      signature: hashJson({ complete_fragments: fragments, before: "fragment-boundary", after: "fragment-boundary" }),
    };
  }
  const fragment = parseStoredFragments(application.fragments_json).find((candidate) =>
    candidate.fragment === application.fragment
    && application.start_byte! >= candidate.start_byte
    && application.end_byte! <= candidate.end_byte);
  if (!fragment) throw new Error(`Audit application ${application.id} no longer fits its persisted source fragment.`);
  const before = application.start_byte === fragment.start_byte
    ? ""
    : exactSpan(application.source_text, fragment.start_byte, application.start_byte);
  const after = application.end_byte === fragment.end_byte
    ? ""
    : exactSpan(application.source_text, application.end_byte, fragment.end_byte);
  const beforeContext = [...before].slice(-160).join("");
  const afterContext = [...after].slice(0, 160).join("");
  const normalizedBefore = [...normalizedSurface(beforeContext)].slice(-64).join("");
  const normalizedAfter = [...normalizedSurface(afterContext)].slice(0, 64).join("");
  return {
    before: beforeContext,
    after: afterContext,
    signature: hashJson({ fragment: application.fragment, before: normalizedBefore, after: normalizedAfter }),
  };
}

function containsJsonValue(value: unknown, target: string): boolean {
  if (value === target) return true;
  if (Array.isArray(value)) return value.some((item) => containsJsonValue(item, target));
  return Boolean(value && typeof value === "object" && Object.values(value).some((item) => containsJsonValue(item, target)));
}

/** Locate durable publication receipts whose manifests name drafts depending on one rule revision. */
export function affectedPublishedEntries(db: DatabaseSync, stampId: string, revision: number): AffectedPublishedEntry[] {
  const draftRows = db.prepare(`
    SELECT assembly_drafts.id AS draft_id, abilities.faction_id, abilities.ability_id,
      stamp_applications.stamp_id, stamp_applications.stamp_revision,
      stamp_applications.dependencies_json
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    ORDER BY assembly_drafts.id
  `).all() as Array<{
    draft_id: string;
    faction_id: string;
    ability_id: string;
    stamp_id: string;
    stamp_revision: number;
    dependencies_json: string;
  }>;
  const affectedDrafts = draftRows.filter((draft) => {
    if (draft.stamp_id === stampId && draft.stamp_revision === revision) return true;
    const dependencies = JSON.parse(draft.dependencies_json) as { equivalent_supports?: unknown };
    return Array.isArray(dependencies.equivalent_supports) && dependencies.equivalent_supports.some((support) =>
      Boolean(support && typeof support === "object" && !Array.isArray(support)
        && "stamp_id" in support && support.stamp_id === stampId
        && "stamp_revision" in support && support.stamp_revision === revision));
  });
  if (affectedDrafts.length === 0) return [];
  const publications = db.prepare(`
    SELECT id, manifest_json FROM publication_batches
    WHERE state = 'published' ORDER BY created_at, id
  `).all() as Array<{ id: string; manifest_json: string }>;
  const result: AffectedPublishedEntry[] = [];
  for (const publication of publications) {
    const manifest: unknown = JSON.parse(publication.manifest_json);
    for (const draft of affectedDrafts) {
      if (!containsJsonValue(manifest, draft.draft_id)) continue;
      result.push({
        publication_batch_id: publication.id,
        faction_id: draft.faction_id,
        ability_id: draft.ability_id,
        draft_id: draft.draft_id,
      });
    }
  }
  return result;
}

export function getStampAudit(db: DatabaseSync, stampId: string, revision: number, options: { cursor?: string } = {}): StampAuditPage {
  initializeWorkbench(db);
  const stamp = requireStamp(db, stampId, revision);
  const definition = parsedDefinition(stamp);
  const applications = db.prepare(`
    SELECT stamp_applications.id, stamp_applications.inputs_hash,
      stamp_applications.variant_id, stamp_applications.bindings_json,
      stamp_applications.dependencies_json, stamp_applications.ability_version_id,
      stamp_applications.annotation_id, abilities.source_hash, abilities.source_text,
      abilities.fragments_json, abilities.faction_id, abilities.ability_id,
      source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      source_spans.exact_text
    FROM stamp_applications
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    LEFT JOIN source_spans ON source_spans.id = stamp_applications.span_id
    WHERE stamp_applications.stamp_id = ? AND stamp_applications.stamp_revision = ?
      AND stamp_applications.status = 'active' AND abilities.current = 1
    ORDER BY stamp_applications.id
  `).all(stampId, revision) as StampAuditApplication[];
  const sampleOrder = applications.slice().sort((left, right) =>
    hashJson({ stamp_id: stampId, revision, application_id: left.id })
      .localeCompare(hashJson({ stamp_id: stampId, revision, application_id: right.id }))
    || left.id.localeCompare(right.id));
  const slotsByVariant = new Map(definition.variants.map((variant) => [variant.id, variant.slots]));
  const contexts = new Map(applications.map((application) => [application.id, contextForAudit(application)]));
  const selected = new Map<string, { application: StampAuditApplication; strata: Set<string> }>();
  const stratumSets = {
    variants: new Set<string>(),
    enum_combinations: new Set<string>(),
    numeric_extrema: new Set<string>(),
    neighboring_contexts: new Set<string>(),
  };
  const add = (application: StampAuditApplication, label: string, kind: keyof typeof stratumSets): void => {
    stratumSets[kind].add(label);
    const existing = selected.get(application.id) ?? { application, strata: new Set<string>() };
    existing.strata.add(label);
    selected.set(application.id, existing);
  };
  const firstBy = (keyOf: (application: StampAuditApplication) => string | null): Map<string, StampAuditApplication> => {
    const result = new Map<string, StampAuditApplication>();
    for (const application of sampleOrder) {
      const key = keyOf(application);
      if (key !== null && !result.has(key)) result.set(key, application);
    }
    return result;
  };
  for (const [key, application] of firstBy((item) => `variant:${item.variant_id}`).entries()) {
    add(application, key, "variants");
  }
  for (const [key, application] of firstBy((item) => {
    const slots = slotsByVariant.get(item.variant_id);
    if (!slots) return null;
    const bindings = JSON.parse(item.bindings_json) as Record<string, unknown>;
    const combination = Object.keys(slots).filter((name) => slots[name]!.kind === "enum").sort()
      .map((name) => [name, bindings[name]]);
    return combination.length === 0 ? null : `enum:${item.variant_id}:${JSON.stringify(combination)}`;
  }).entries()) add(application, key, "enum_combinations");
  for (const [variantId, slots] of slotsByVariant) {
    for (const [slotName, slot] of Object.entries(slots)) {
      if (slot.kind !== "integer") continue;
      const observations = sampleOrder.flatMap((application) => {
        if (application.variant_id !== variantId) return [];
        const value = (JSON.parse(application.bindings_json) as Record<string, unknown>)[slotName];
        return typeof value === "number" && Number.isSafeInteger(value) ? [{ application, value }] : [];
      });
      if (observations.length === 0) continue;
      const minimum = Math.min(...observations.map((observation) => observation.value));
      const maximum = Math.max(...observations.map((observation) => observation.value));
      const minimumApplication = observations.find((observation) => observation.value === minimum)!.application;
      const maximumApplication = observations.find((observation) => observation.value === maximum)!.application;
      add(minimumApplication, `numeric:${variantId}:${slotName}:min:${minimum}`, "numeric_extrema");
      add(maximumApplication, `numeric:${variantId}:${slotName}:max:${maximum}`, "numeric_extrema");
    }
  }
  for (const [key, application] of firstBy((item) => `context:${contexts.get(item.id)!.signature}`).entries()) {
    add(application, key, "neighboring_contexts");
  }
  let additional = 0;
  for (const application of sampleOrder) {
    if (selected.has(application.id) || additional >= 5) continue;
    selected.set(application.id, { application, strata: new Set([`additional:${additional + 1}`]) });
    additional += 1;
  }
  const pool = [...selected.values()].sort((left, right) =>
    hashJson({ stamp_id: stampId, revision, application_id: left.application.id })
      .localeCompare(hashJson({ stamp_id: stampId, revision, application_id: right.application.id }))
    || left.application.id.localeCompare(right.application.id));
  const auditHash = hashJson({
    stamp_id: stampId,
    revision,
    definition_hash: stamp.definition_hash,
    pool: pool.map(({ application, strata }) => ({
      application_id: application.id,
      inputs_hash: application.inputs_hash,
      source_hash: application.source_hash,
      dependency_hash: hashJson(JSON.parse(application.dependencies_json)),
      strata: [...strata].sort(),
    })),
  });
  const offset = auditCursorOffset(options.cursor, auditHash);
  const latestAudits = db.prepare(`
    SELECT stamp_audit_decisions.application_id, stamp_audit_decisions.verdict,
      stamp_audit_decisions.scope, stamp_audit_decisions.created_at,
      annotation_batches.reviewer
    FROM stamp_audit_decisions
    JOIN annotation_batches ON annotation_batches.id = stamp_audit_decisions.batch_id
    WHERE stamp_audit_decisions.stamp_id = ? AND stamp_audit_decisions.stamp_revision = ?
    ORDER BY stamp_audit_decisions.application_id, stamp_audit_decisions.created_at DESC,
      stamp_audit_decisions.id DESC
  `).all(stampId, revision) as Array<{
    application_id: string;
    verdict: "correct" | "incorrect" | "uncertain";
    scope: "occurrence" | "rule" | null;
    created_at: string;
    reviewer: string;
  }>;
  const latestByApplication = new Map<string, typeof latestAudits[number]>();
  for (const audit of latestAudits) if (!latestByApplication.has(audit.application_id)) latestByApplication.set(audit.application_id, audit);
  const page: StampAuditItem[] = pool.slice(offset, offset + PAGE_SIZE).map(({ application, strata }) => {
    const bindings = JSON.parse(application.bindings_json) as Record<string, unknown>;
    const dependencies = JSON.parse(application.dependencies_json) as Record<string, unknown>;
    const complete = application.fragment === null || application.start_byte === null || application.end_byte === null;
    return {
      application_id: application.id,
      inputs_hash: application.inputs_hash,
      variant_id: application.variant_id,
      bindings,
      dependencies,
      dependency_hash: hashJson(dependencies),
      ability_version_id: application.ability_version_id,
      faction_id: application.faction_id,
      ability_id: application.ability_id,
      source_hash: application.source_hash,
      fragment: complete ? "__complete__" : application.fragment!,
      start_byte: complete ? 0 : application.start_byte!,
      end_byte: complete ? Buffer.byteLength(application.source_text, "utf8") : application.end_byte!,
      exact_text: complete ? application.source_text : application.exact_text!,
      neighboring_context: contexts.get(application.id)!,
      strata: [...strata].sort(),
      latest_audit: latestByApplication.get(application.id) ?? null,
    };
  });
  const represented = (kind: keyof typeof stratumSets): number => new Set(pool.flatMap((entry) =>
    [...entry.strata].filter((label) => stratumSets[kind].has(label)))).size;
  const coverage: StampAuditCoverage = {
    applications: applications.length,
    selected: pool.length,
    strata: Object.values(stratumSets).reduce((total, strata) => total + strata.size, 0),
    variants: { observed: stratumSets.variants.size, represented: represented("variants") },
    enum_combinations: { observed: stratumSets.enum_combinations.size, represented: represented("enum_combinations") },
    numeric_extrema: { observed: stratumSets.numeric_extrema.size, represented: represented("numeric_extrema") },
    neighboring_contexts: { observed: stratumSets.neighboring_contexts.size, represented: represented("neighboring_contexts") },
    additional,
  };
  return {
    stamp_id: stampId,
    revision,
    audit_hash: auditHash,
    items: page,
    coverage,
    next_cursor: offset + PAGE_SIZE < pool.length ? encodeAuditCursor(auditHash, offset + PAGE_SIZE) : null,
  };
}

export type StampAuditResult = {
  audit_id: string;
  batch_id: string;
  correction: {
    ability_version_id: number;
    fragment: string;
    start_byte: number;
    end_byte: number;
    exact_text: string;
  } | null;
  affected_published_entries: AffectedPublishedEntry[];
};

export function recordStampAudit(db: DatabaseSync, body: {
  stamp_id: string;
  revision: number;
  application_id: string;
  reviewer: string;
  source_hash: string;
  dependency_hash: string;
  verdict: "correct" | "incorrect" | "uncertain";
  scope?: "occurrence" | "rule";
}): StampAuditResult {
  initializeWorkbench(db);
  if (!body.reviewer?.trim()) throw new StampError(422, "reviewer is required.");
  if (!["correct", "incorrect", "uncertain"].includes(body.verdict)) throw new StampError(422, "Audit verdict is invalid.");
  if (body.verdict === "incorrect" && body.scope !== "occurrence" && body.scope !== "rule") {
    throw new StampError(422, "Incorrect audits require occurrence or rule scope.");
  }
  if (body.verdict !== "incorrect" && body.scope !== undefined) throw new StampError(422, "Only an incorrect audit has a scope.");
  if (typeof body.source_hash !== "string" || body.source_hash.length !== 64 || typeof body.dependency_hash !== "string" || body.dependency_hash.length !== 64) {
    throw new StampError(422, "Audit source_hash and dependency_hash must be pinned hashes.");
  }
  return withTransaction(db, () => {
    const stamp = requireStamp(db, body.stamp_id, body.revision);
    const application = db.prepare(`
      SELECT stamp_applications.id, stamp_applications.ability_version_id,
        stamp_applications.variant_id, stamp_applications.source_hash,
        stamp_applications.dependencies_json, stamp_applications.annotation_id,
        source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
        source_spans.exact_text
      FROM (
        SELECT stamp_applications.*, abilities.source_hash
        FROM stamp_applications
        JOIN abilities ON abilities.id = stamp_applications.ability_version_id
        WHERE abilities.current = 1
      ) AS stamp_applications
      LEFT JOIN source_spans ON source_spans.id = stamp_applications.span_id
      WHERE stamp_applications.id = ? AND stamp_applications.stamp_id = ?
        AND stamp_applications.stamp_revision = ?
        AND stamp_applications.status = 'active'
    `).get(body.application_id, body.stamp_id, body.revision) as {
      id: string;
      ability_version_id: number;
      variant_id: string;
      source_hash: string;
      dependencies_json: string;
      annotation_id: number | null;
      fragment: string | null;
      start_byte: number | null;
      end_byte: number | null;
      exact_text: string | null;
    } | undefined;
    if (
      !application
      || application.source_hash !== body.source_hash
      || hashJson(JSON.parse(application.dependencies_json)) !== body.dependency_hash
    ) throw new StampError(409, "Audit evidence changed.");
    if (body.verdict === "incorrect" && body.scope === "rule" && stamp.status !== "approved") {
      throw new StampError(409, "The audited rule is no longer approved.");
    }
    const affected = body.verdict === "incorrect" && body.scope === "rule"
      ? affectedPublishedEntries(db, body.stamp_id, body.revision)
      : [];
    const batchId = batch(db, "stamp-audit", body.reviewer.trim());
    const auditId = `audit_${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO stamp_audit_decisions (
        id, batch_id, stamp_id, stamp_revision, application_id,
        ability_version_id, source_hash, dependency_hash, verdict, scope, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      batchId,
      body.stamp_id,
      body.revision,
      application.id,
      application.ability_version_id,
      application.source_hash,
      body.dependency_hash,
      body.verdict,
      body.verdict === "incorrect" ? body.scope ?? null : null,
      now,
    );
    member(db, batchId, "stamp-audit-decision", auditId);
    let correction: StampAuditResult["correction"] = null;
    if (body.verdict === "incorrect" && body.scope === "rule") {
      db.prepare("UPDATE stamps SET status = 'suspended', updated_at = ? WHERE id = ? AND revision = ?")
        .run(now, body.stamp_id, body.revision);
      invalidateStampRevision(db, body.stamp_id, body.revision, "AUDIT_RULE_INCORRECT");
      member(db, batchId, "stamp-suspended", `${body.stamp_id}@${body.revision}`);
      applyStamps(db, { bump_revision: false });
    } else if (body.verdict === "incorrect") {
      upsertEscalation(db, "SOURCE_AMBIGUITY", {
        stamp_id: body.stamp_id,
        revision: body.revision,
        variant_id: application.variant_id,
        audit_application_id: application.id,
        correction_required: true,
      }, [{ ability_version_id: application.ability_version_id, source_hash: application.source_hash }]);
      applyStamps(db, { ability_version_ids: [application.ability_version_id], bump_revision: false });
      if (
        application.fragment !== null
        && application.start_byte !== null
        && application.end_byte !== null
        && application.exact_text !== null
      ) {
        correction = {
          ability_version_id: application.ability_version_id,
          fragment: application.fragment,
          start_byte: application.start_byte,
          end_byte: application.end_byte,
          exact_text: application.exact_text,
        };
      }
    } else if (body.verdict === "uncertain") {
      upsertEscalation(db, "MODEL_ERROR", {
        stamp_id: body.stamp_id,
        revision: body.revision,
        variant_id: application.variant_id,
        audit_application_id: application.id,
        challenge_required: true,
      }, [{ ability_version_id: application.ability_version_id, source_hash: application.source_hash }]);
    }
    bumpWorkbenchRevision(db);
    return {
      audit_id: auditId,
      batch_id: batchId,
      correction,
      affected_published_entries: affected,
    };
  });
}

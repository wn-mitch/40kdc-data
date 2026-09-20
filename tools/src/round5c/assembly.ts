import type Ajv from "ajv";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { buildRepairedEntry, lintCanonical } from "../author-batch.js";
import { hashJson } from "../round4/hash.js";
import { loadWitnessInputs, ROUND5C_RELATION_TYPES, sourceWitnessProblems } from "./relations.js";
import { createValidator, findSchemaFiles, SCHEMAS_ROOT } from "../schema-loader.js";
import { describeAbility } from "../translate/effect.js";
import type { CompositionStampVariant, SourceGraph, SourceGraphNode, SourceGraphRelation, StampDefinition, StampLeafSegment, StampTemplate } from "./contracts.js";
import { annotationHasEffectiveAuthority, bumpWorkbenchRevision, parseStoredFragments, withTransaction } from "./db.js";
import { instantiateTemplate, matchFragmentPattern, sourceTypeAllowed, validateStampDefinition, type MatchLeafEvidence, type PatternMatch, type PatternSourceFragment, type SegmentEvidence } from "./matching.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const ABILITY_SCHEMA_ID = "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json";
const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
const NODE_ID = /^[a-z][a-z0-9_]*$/u;

class SourceGraphValidationError extends TypeError {
  readonly reasonCode: "RELATION_GAP" | "SOURCE_AMBIGUITY";

  constructor(reasonCode: "RELATION_GAP" | "SOURCE_AMBIGUITY", message: string) {
    super(message);
    this.name = "SourceGraphValidationError";
    this.reasonCode = reasonCode;
  }
}

type AbilityRow = {
  id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  source_type: string | null;
  fragments_json: string;
};

type StampRow = {
  id: string;
  revision: number;
  definition_json: string;
  definition_hash: string;
  approval_batch_id: string;
};

type CompleteMatch = {
  stamp: StampRow;
  variant: CompositionStampVariant;
  ability: AbilityRow;
  bindings: Record<string, unknown>;
  segments: Record<string, SegmentEvidence>;
  leaf_dependencies: number[];
};

export type ResolvedAbilityEntity = {
  file: string;
  entries: Array<Record<string, unknown>>;
  index: number;
  entry: Record<string, unknown>;
};

type MechanicsEnvelope = {
  effect: Record<string, unknown>;
  scope: Record<string, unknown>;
  behavior: string | null;
  trigger: unknown | null;
  usage: unknown | null;
  applies_to: unknown | null;
};

type EntityDependency = {
  faction_id: string;
  ability_id: string;
  entry_hash: string;
};

export type AssemblyResult = { proposed: number; blocked: number; stale: number; changed: boolean };
export type EscalationWriter = (
  reasonCode: "NEW_FORM" | "PARAMETER_BOUNDARY" | "CONFLICT" | "RELATION_GAP" | "COMPOSITION_GAP" | "DSL_GAP" | "SOURCE_AMBIGUITY" | "MODEL_ERROR" | "OVERSIZED" | "ENTITY_RESOLUTION",
  question: Record<string, unknown>,
  members: Array<{ ability_version_id: number; source_hash: string; span?: PatternMatch; draft_id?: string; gap_id?: number }>,
) => string;

export function round5cDataRoot(): string {
  return resolve(process.env.ROUND5C_DATA_ROOT ?? resolve(repositoryRoot, "data"));
}

export function canonicalDataRoot(dataRoot = round5cDataRoot()): string {
  const configured = resolve(dataRoot);
  if (!existsSync(configured)) throw new Error(`Configured data root ${configured} does not exist.`);
  const canonical = realpathSync(configured);
  if (lstatSync(canonical).isSymbolicLink()) throw new Error("Configured data root must resolve to a real directory.");
  return canonical;
}

export function schemaTreeHash(): string {
  const entries = findSchemaFiles(SCHEMAS_ROOT).sort().map((file) => ({
    path: relative(SCHEMAS_ROOT, file).split(sep).join("/"),
    content: readFileSync(file, "utf8"),
  }));
  return hashJson(entries);
}

function safeFactionDirectory(dataRoot: string, factionId: string): string {
  if (factionId !== "_core" && !ENTITY_ID.test(factionId)) throw new Error(`Invalid faction id ${factionId}.`);
  const root = canonicalDataRoot(dataRoot);
  const enrichment = resolve(root, "enrichment");
  if (!existsSync(enrichment) || realpathSync(enrichment) !== enrichment || lstatSync(enrichment).isSymbolicLink()) {
    throw new Error("Configured enrichment directory is missing or symlinked.");
  }
  const directory = resolve(enrichment, factionId);
  if (directory !== enrichment && !directory.startsWith(`${enrichment}${sep}`)) throw new Error("Faction path escapes the data root.");
  if (!existsSync(directory)) throw new Error(`Faction directory ${factionId} does not exist under the configured data root.`);
  const canonical = realpathSync(directory);
  if (canonical !== directory || lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Faction directory ${factionId} is symlinked or escapes the configured data root.`);
  }
  return canonical;
}

export function abilityFilePath(dataRoot: string, factionId: string): string {
  const directory = safeFactionDirectory(dataRoot, factionId);
  const file = resolve(directory, "abilities.json");
  if (!existsSync(file)) throw new Error(`Faction ${factionId} has no abilities.json.`);
  const canonical = realpathSync(file);
  if (
    canonical !== file
    || lstatSync(file).isSymbolicLink()
    || !canonical.startsWith(`${canonicalDataRoot(dataRoot)}${sep}`)
  ) throw new Error(`Faction ${factionId} abilities.json is symlinked or escapes the configured data root.`);
  return canonical;
}

export function resolveAbilityEntity(dataRoot: string, factionId: string, abilityId: string): ResolvedAbilityEntity {
  if (!ENTITY_ID.test(abilityId)) throw new Error(`Invalid ability id ${abilityId}.`);
  const file = abilityFilePath(dataRoot, factionId);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} is not an ability array.`);
  const entries = parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}[${index}] is not an ability object.`);
    return value as Record<string, unknown>;
  });
  const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.ability_id === abilityId);
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `Ability ${factionId}/${abilityId} is missing.` : `Ability ${factionId}/${abilityId} is ambiguous.`);
  return { file, entries, index: matches[0]!.index, entry: matches[0]!.entry };
}

function activeLeaves(db: DatabaseSync, abilityVersionId: number): MatchLeafEvidence[] {
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

function compatibleBindings(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return Object.entries(right).every(([key, value]) => !Object.hasOwn(left, key) || JSON.stringify(left[key]) === JSON.stringify(value));
}

function completeMatches(stamp: StampRow, definition: Extract<StampDefinition, { kind: "composition" }>, ability: AbilityRow): CompleteMatch[] {
  const fragments = parseStoredFragments(ability.fragments_json).map((fragment): PatternSourceFragment => ({ ...fragment }));
  const leaves = activeLeavesCache.get(ability.id) ?? [];
  const results: CompleteMatch[] = [];
  for (const variant of definition.variants) {
    if (!sourceTypeAllowed(variant.source_types, ability.source_type) || variant.fragments.length !== fragments.length) continue;
    let partials: Array<{ bindings: Record<string, unknown>; segments: Record<string, SegmentEvidence>; leaf_dependencies: number[] }> = [{ bindings: {}, segments: {}, leaf_dependencies: [] }];
    for (let index = 0; index < variant.fragments.length; index += 1) {
      const pattern = variant.fragments[index]!;
      const source = fragments[index]!;
      if (pattern.fragment !== source.fragment) {
        partials = [];
        break;
      }
      const matches = matchFragmentPattern(pattern, variant.slots, source, { complete: true, leaves });
      const next: typeof partials = [];
      for (const partial of partials) {
        for (const match of matches) {
          if (!compatibleBindings(partial.bindings, match.bindings)) continue;
          next.push({ bindings: { ...partial.bindings, ...match.bindings }, segments: { ...partial.segments, ...match.segments }, leaf_dependencies: [...new Set([...partial.leaf_dependencies, ...match.leaf_dependencies])].sort((left, right) => left - right) });
        }
      }
      partials = next;
    }
    for (const partial of partials) results.push({ stamp, variant, ability, ...partial });
  }
  return results;
}

const activeLeavesCache = new Map<number, MatchLeafEvidence[]>();

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function evidence(value: unknown, label: string, segments: Record<string, SegmentEvidence>, sourceText: string): SourceGraphNode["evidence"] {
  const input = record(value, label);
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["first_segment_id", "fragment", "last_segment_id"])) throw new TypeError(`${label} must contain fragment, first_segment_id, and last_segment_id.`);
  if (typeof input.fragment !== "string" || typeof input.first_segment_id !== "string" || typeof input.last_segment_id !== "string") throw new TypeError(`${label} fields must be strings.`);
  const first = segments[input.first_segment_id];
  const last = segments[input.last_segment_id];
  if (!first || !last || first.fragment !== input.fragment || last.fragment !== input.fragment || first.start_byte > last.start_byte || first.end_byte > last.end_byte) throw new TypeError(`${label} references invalid grounded segments.`);
  const startByte = first.start_byte;
  const endByte = last.end_byte;
  return { fragment: input.fragment, first_segment_id: input.first_segment_id, last_segment_id: input.last_segment_id, start_byte: startByte, end_byte: endByte, exact_text: Buffer.from(sourceText, "utf8").subarray(startByte, endByte).toString("utf8") };
}

function validateGraph(value: unknown, match: CompleteMatch): SourceGraph {
  const input = record(value, "source graph");
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["nodes", "relations", "roots", "schema_version"]) || input.schema_version !== 1 || !Array.isArray(input.nodes) || !Array.isArray(input.relations) || !Array.isArray(input.roots)) throw new TypeError("Source graph must be a closed schema_version 1 graph.");
  const nodeIds = new Set<string>();
  const nodes = input.nodes.map((value, index): SourceGraphNode => {
    const node = record(value, `source graph node ${index}`);
    const allowed = ["id", "kind", "parameters", "evidence", "family_id", "family_version"];
    if (Object.keys(node).some((key) => !allowed.includes(key)) || typeof node.id !== "string" || !NODE_ID.test(node.id) || nodeIds.has(node.id)) throw new TypeError(`Source graph node ${index} has an invalid or duplicate id.`);
    nodeIds.add(node.id);
    if (node.kind !== "leaf" && node.kind !== "participant" && node.kind !== "selector" && node.kind !== "usage" && node.kind !== "binding") throw new TypeError(`Source graph node ${node.id} has an invalid kind.`);
    if (node.kind !== "leaf" && (Object.hasOwn(node, "family_id") || Object.hasOwn(node, "family_version"))) {
      throw new TypeError(`Non-leaf source graph node ${node.id} cannot name a semantic family.`);
    }
    const parameters = record(node.parameters, `source graph node ${node.id}.parameters`);
    const graphNode: SourceGraphNode = { id: node.id, kind: node.kind, parameters, evidence: evidence(node.evidence, `source graph node ${node.id}.evidence`, match.segments, match.ability.source_text) };
    if (node.kind === "leaf") {
      if (typeof node.family_id !== "string" || typeof node.family_version !== "number" || !Number.isSafeInteger(node.family_version)) throw new TypeError(`Leaf node ${node.id} requires a reviewed family.`);
      const leafSegment = match.variant.fragments.flatMap((fragment) => fragment.segments)
        .filter((candidate): candidate is StampLeafSegment => "leaf" in candidate)
        .find((candidate) => {
          const grounded = match.segments[candidate.id];
          const binding = match.bindings[candidate.id] as { parameters?: unknown } | undefined;
          return grounded?.fragment === graphNode.evidence.fragment
            && grounded.start_byte === graphNode.evidence.start_byte
            && grounded.end_byte === graphNode.evidence.end_byte
            && candidate.leaf.family_id === node.family_id
            && candidate.leaf.family_version === node.family_version
            && binding !== undefined
            && hashJson(binding.parameters) === hashJson(parameters);
        });
      if (!leafSegment) throw new TypeError(`Leaf node ${node.id} is not grounded in one exact approved leaf reference with the same parameters.`);
      graphNode.family_id = node.family_id;
      graphNode.family_version = node.family_version;
    }
    return graphNode;
  });
  const relationIds = new Set<string>();
  const relations = input.relations.map((value, index): SourceGraphRelation => {
    const relation = record(value, `source graph relation ${index}`);
    const relationKeys = Object.keys(relation).sort();
    if (JSON.stringify(relationKeys) !== JSON.stringify(["evidence", "from_node_id", "id", "to_node_id", "type"]) || typeof relation.id !== "string" || !NODE_ID.test(relation.id) || relationIds.has(relation.id) || typeof relation.type !== "string" || typeof relation.from_node_id !== "string" || typeof relation.to_node_id !== "string") throw new TypeError(`Source graph relation ${index} is invalid.`);
    if (!(ROUND5C_RELATION_TYPES as readonly string[]).includes(relation.type)) throw new SourceGraphValidationError("RELATION_GAP", `Source graph relation ${relation.id} uses unsupported relationship ${relation.type}.`);
    relationIds.add(relation.id);
    if (!nodeIds.has(relation.from_node_id) || !nodeIds.has(relation.to_node_id)) throw new TypeError(`Source graph relation ${relation.id} has an unknown endpoint.`);
    return { id: relation.id, type: relation.type, from_node_id: relation.from_node_id, to_node_id: relation.to_node_id, evidence: evidence(relation.evidence, `source graph relation ${relation.id}.evidence`, match.segments, match.ability.source_text) };
  });
  const roots = input.roots.map((root, index) => {
    if (typeof root !== "string" || !nodeIds.has(root)) throw new TypeError(`Source graph root ${index} is unknown.`);
    return root;
  });
  if (roots.length === 0) throw new TypeError("Source graph requires at least one root.");
  if (new Set(roots).size !== roots.length) throw new TypeError("Source graph roots must be unique.");
  const sourceOrder = (value: SourceGraphNode | SourceGraphRelation): number => value.evidence.start_byte ?? Number.MAX_SAFE_INTEGER;
  nodes.sort((left, right) => sourceOrder(left) - sourceOrder(right) || left.id.localeCompare(right.id));
  relations.sort((left, right) => sourceOrder(left) - sourceOrder(right) || left.id.localeCompare(right.id));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  roots.sort((left, right) => nodeOrder.get(left)! - nodeOrder.get(right)! || left.localeCompare(right));
  return { schema_version: 1, nodes, relations, roots };
}

function sourceQualifiedValue(value: unknown): value is { source: string } {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && "source" in value
    && typeof value.source === "string",
  );
}

function assertMechanicsBindingPath(bindings: Record<string, unknown>, path: string): void {
  let value: unknown = bindings;
  for (const part of path.split(".")) {
    if (sourceQualifiedValue(value)) {
      throw new TypeError("A source-qualified semantic value cannot be traversed or bound into DSL mechanics.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, part)) {
      throw new TypeError(`Template binding ${path} is unavailable.`);
    }
    const object = value as Record<string, unknown>;
    value = object[part];
  }
  if (sourceQualifiedValue(value)) {
    throw new TypeError("A source-qualified semantic value cannot be traversed or bound into DSL mechanics.");
  }
}

function rejectSourceQualifiedMechanicsBindings(template: StampTemplate, bindings: Record<string, unknown>): void {
  if (template === null || typeof template !== "object") return;
  if (Array.isArray(template)) {
    for (const item of template) rejectSourceQualifiedMechanicsBindings(item, bindings);
    return;
  }
  if ("$bind" in template) {
    if (typeof template.$bind !== "string") throw new TypeError("Template binding path is malformed.");
    assertMechanicsBindingPath(bindings, template.$bind);
    return;
  }
  if ("$case" in template) {
    if (typeof template.$case !== "string" || !Array.isArray(template.cases)) throw new TypeError("Template cases are malformed.");
    assertMechanicsBindingPath(bindings, template.$case);
    for (const branch of template.cases) {
      if (!branch || typeof branch !== "object" || !("then" in branch)) throw new TypeError("Template case is malformed.");
      rejectSourceQualifiedMechanicsBindings(branch.then, bindings);
    }
    return;
  }
  for (const value of Object.values(template)) rejectSourceQualifiedMechanicsBindings(value, bindings);
}

function parseEntityDependency(value: unknown): EntityDependency | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("faction_id" in value) || typeof value.faction_id !== "string"
    || !("ability_id" in value) || typeof value.ability_id !== "string"
    || !("entry_hash" in value) || typeof value.entry_hash !== "string") return null;
  return { faction_id: value.faction_id, ability_id: value.ability_id, entry_hash: value.entry_hash };
}

function mechanicsEnvelope(value: unknown): MechanicsEnvelope {
  const input = record(value, "mechanics template output");
  const expected = ["applies_to", "behavior", "effect", "scope", "trigger", "usage"].sort();
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected)) throw new TypeError("Mechanics template must emit the complete effect/scope/behavior/trigger/usage/applies_to envelope.");
  const effect = record(input.effect, "mechanics effect");
  const scope = record(input.scope, "mechanics scope");
  if (input.behavior !== null && typeof input.behavior !== "string") throw new TypeError("Mechanics behavior must be a string or null.");
  return { effect, scope, behavior: input.behavior, trigger: input.trigger ?? null, usage: input.usage ?? null, applies_to: input.applies_to ?? null };
}

function applicationId(match: CompleteMatch): string {
  return `application_${hashJson({ assembler: "round5c/stamp-assembler/v1", stamp_id: match.stamp.id, revision: match.stamp.revision, ability_version_id: match.ability.id, variant_id: match.variant.id, bindings: match.bindings, leaf_dependencies: match.leaf_dependencies })}`;
}

function draftId(application: string): string {
  return `draft_${hashJson({ assembler: "round5c/stamp-assembler/v1", application })}`;
}

function persistCompositionApplication(db: DatabaseSync, match: CompleteMatch, id: string, inputsHash: string, dependencies: Record<string, unknown>, status: "active" | "blocked", reasonCode: string | null): boolean {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT inputs_hash, status, reason_code FROM stamp_applications WHERE id = ?").get(id) as { inputs_hash: string; status: string; reason_code: string | null } | undefined;
  if (existing?.inputs_hash === inputsHash && existing.status === status && existing.reason_code === reasonCode) return false;
  db.prepare(`
    INSERT INTO stamp_applications (id, stamp_id, stamp_revision, ability_version_id, span_id, annotation_id, variant_id, inputs_hash, bindings_json, dependencies_json, status, reason_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET inputs_hash = excluded.inputs_hash, bindings_json = excluded.bindings_json,
      dependencies_json = excluded.dependencies_json, status = excluded.status, reason_code = excluded.reason_code,
      updated_at = excluded.updated_at
  `).run(id, match.stamp.id, match.stamp.revision, match.ability.id, match.variant.id, inputsHash, JSON.stringify(match.bindings), JSON.stringify(dependencies), status, reasonCode, now, now);
  return true;
}

function persistDraft(db: DatabaseSync, body: { id: string; application_id: string; graph: SourceGraph; mechanics: Record<string, unknown> | null; rendered_text: string | null; inputs_hash: string; schema_hash: string; status: "proposed" | "blocked"; diagnostic: Record<string, unknown> }): boolean {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT inputs_hash, status, verifier_run_id, diagnostic_json FROM assembly_drafts WHERE id = ?").get(body.id) as { inputs_hash: string; status: string; verifier_run_id: number | null; diagnostic_json: string } | undefined;
  if (existing?.inputs_hash === body.inputs_hash && existing.verifier_run_id !== null && (existing.status === "accepted" || existing.status === "blocked")) return false;
  if (existing?.inputs_hash === body.inputs_hash && existing.status === body.status && hashJson(JSON.parse(existing.diagnostic_json)) === hashJson(body.diagnostic)) return false;
  db.prepare(`
    INSERT INTO assembly_drafts (id, composition_application_id, graph_json, mechanics_json, rendered_text, inputs_hash, schema_hash, status, verifier_run_id, diagnostic_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET graph_json = excluded.graph_json, mechanics_json = excluded.mechanics_json,
      rendered_text = excluded.rendered_text, inputs_hash = excluded.inputs_hash, schema_hash = excluded.schema_hash,
      status = excluded.status, verifier_run_id = NULL, diagnostic_json = excluded.diagnostic_json,
      updated_at = excluded.updated_at
  `).run(body.id, body.application_id, JSON.stringify(body.graph), body.mechanics === null ? null : JSON.stringify(body.mechanics), body.rendered_text, body.inputs_hash, body.schema_hash, body.status, JSON.stringify(body.diagnostic), now, now);
  return true;
}

function assembleOne(
  db: DatabaseSync,
  supportMatches: CompleteMatch[],
  schemaHash: string,
  validator: Ajv,
  createEscalation: EscalationWriter,
): { proposed: number; blocked: number; changed: boolean } {
  const ordered = supportMatches.slice().sort((left, right) =>
    left.stamp.id.localeCompare(right.stamp.id)
    || left.stamp.revision - right.stamp.revision
    || left.variant.id.localeCompare(right.variant.id)
    || hashJson(left.bindings).localeCompare(hashJson(right.bindings)));
  const match = ordered[0]!;
  const supports = ordered.map((candidate) => ({
    application_id: applicationId(candidate),
    stamp_id: candidate.stamp.id,
    stamp_revision: candidate.stamp.revision,
    definition_hash: candidate.stamp.definition_hash,
    variant_id: candidate.variant.id,
    bindings: candidate.bindings,
    leaf_annotation_ids: candidate.leaf_dependencies,
  }));
  const dependencies: Record<string, unknown> = {
    assembler_version: "round5c/stamp-assembler/v1",
    stamp: { id: match.stamp.id, revision: match.stamp.revision, definition_hash: match.stamp.definition_hash },
    source_hash: match.ability.source_hash,
    leaf_annotation_ids: match.leaf_dependencies,
    schema_hash: schemaHash,
    equivalent_supports: supports,
  };
  const appId = applicationId(match);
  let graph: SourceGraph;
  try {
    graph = validateGraph(instantiateTemplate(match.variant.graph_template, match.bindings), match);
    const unwitnessed = sourceWitnessProblems(graph, loadWitnessInputs(db, match.ability.id));
    if (unwitnessed.length > 0) throw new SourceGraphValidationError("RELATION_GAP", unwitnessed.join(" "));
  } catch (error) {
    const reasonCode = error instanceof SourceGraphValidationError ? error.reasonCode : "SOURCE_AMBIGUITY";
    let changed = false;
    for (const support of ordered) {
      const ownDependencies = { assembler_version: "round5c/stamp-assembler/v1", stamp: { id: support.stamp.id, revision: support.stamp.revision, definition_hash: support.stamp.definition_hash }, source_hash: support.ability.source_hash, leaf_annotation_ids: support.leaf_dependencies, schema_hash: schemaHash };
      const inputsHash = hashJson({ dependencies: ownDependencies, bindings: support.bindings, graph_error: error instanceof Error ? error.message : String(error) });
      const supportChanged = persistCompositionApplication(db, support, applicationId(support), inputsHash, ownDependencies, "blocked", reasonCode);
      changed = changed || supportChanged;
    }
    createEscalation(reasonCode, { stamp_id: match.stamp.id, revision: match.stamp.revision, variant_id: match.variant.id, path: "graph_template", error: error instanceof Error ? error.message : String(error) }, [{ ability_version_id: match.ability.id, source_hash: match.ability.source_hash }]);
    return { proposed: 0, blocked: 1, changed };
  }
  let mechanics: Record<string, unknown> | null = null;
  let renderedText: string | null = null;
  let diagnostic: Record<string, unknown> = {};
  let status: "proposed" | "blocked" = "proposed";
  let reasonCode: string | null = null;
  if (match.variant.mechanics_template === null) {
    status = "blocked";
    reasonCode = "DSL_GAP";
    diagnostic = { reason_code: reasonCode, message: "The approved source graph has no mechanics mapping." };
  } else {
    let envelope: MechanicsEnvelope | null = null;
    try {
      rejectSourceQualifiedMechanicsBindings(match.variant.mechanics_template, match.bindings);
      envelope = mechanicsEnvelope(instantiateTemplate(match.variant.mechanics_template, match.bindings));
    } catch (error) {
      status = "blocked";
      reasonCode = "DSL_GAP";
      diagnostic = { reason_code: reasonCode, message: error instanceof Error ? error.message : String(error) };
    }
    if (envelope !== null) {
      let resolved: ResolvedAbilityEntity | null = null;
      try {
        resolved = resolveAbilityEntity(round5cDataRoot(), match.ability.faction_id, match.ability.ability_id);
      } catch (error) {
        status = "blocked";
        reasonCode = "ENTITY_RESOLUTION";
        diagnostic = { reason_code: reasonCode, message: error instanceof Error ? error.message : String(error) };
      }
      if (resolved !== null) {
        dependencies.entity = {
          faction_id: match.ability.faction_id,
          ability_id: match.ability.ability_id,
          entry_hash: hashJson(resolved.entry),
        } satisfies EntityDependency;
        try {
          const preservedNotes = Object.hasOwn(resolved.entry, "community_notes") ? resolved.entry.community_notes : undefined;
          const entry = buildRepairedEntry(resolved.entry, envelope.effect, envelope.scope, envelope.behavior ?? undefined, { trigger: envelope.trigger, usage: envelope.usage, applies_to: envelope.applies_to });
          if (preservedNotes === undefined) delete entry.community_notes;
          else entry.community_notes = preservedNotes;
          if (envelope.behavior === null) delete entry.behavior;
          else entry.behavior = envelope.behavior;
          mechanics = entry;
          const validate = validator.getSchema(ABILITY_SCHEMA_ID);
          if (!validate) throw new Error("Ability schema is not loaded.");
          const valid = validate(entry);
          const lint = lintCanonical(entry.effect);
          if (!valid || !lint.canonical) throw new Error([...(validate.errors ?? []).map((issue) => `${issue.instancePath || "/"} ${issue.message ?? "invalid"}`), ...lint.issues].join("; "));
          renderedText = describeAbility(entry as never);
        } catch (error) {
          status = "blocked";
          reasonCode = "DSL_GAP";
          diagnostic = { reason_code: reasonCode, message: error instanceof Error ? error.message : String(error) };
        }
      }
    }
  }
  const inputsHash = hashJson({ dependencies, bindings: match.bindings, graph, mechanics });
  let changed = false;
  for (const support of ordered) {
    const supportId = applicationId(support);
    const ownDependencies = supportId === appId ? dependencies : {
      assembler_version: "round5c/stamp-assembler/v1",
      stamp: { id: support.stamp.id, revision: support.stamp.revision, definition_hash: support.stamp.definition_hash },
      source_hash: support.ability.source_hash,
      leaf_annotation_ids: support.leaf_dependencies,
      schema_hash: schemaHash,
      ...(dependencies.entity === undefined ? {} : { entity: dependencies.entity }),
    };
    const supportInputsHash = supportId === appId ? inputsHash : hashJson({ dependencies: ownDependencies, bindings: support.bindings, graph, mechanics });
    const supportChanged = persistCompositionApplication(db, support, supportId, supportInputsHash, ownDependencies, status === "proposed" ? "active" : "blocked", reasonCode);
    changed = changed || supportChanged;
  }
  const id = draftId(appId);
  const draftChanged = persistDraft(db, { id, application_id: appId, graph, mechanics, rendered_text: renderedText, inputs_hash: inputsHash, schema_hash: schemaHash, status, diagnostic });
  changed ||= draftChanged;
  if (status === "blocked") createEscalation(reasonCode === "ENTITY_RESOLUTION" ? "ENTITY_RESOLUTION" : "DSL_GAP", { stamp_id: match.stamp.id, revision: match.stamp.revision, variant_id: match.variant.id, diagnostic }, [{ ability_version_id: match.ability.id, source_hash: match.ability.source_hash, draft_id: id }]);
  return status === "proposed" ? { proposed: draftChanged ? 1 : 0, blocked: 0, changed } : { proposed: 0, blocked: 1, changed };
}

/**
 * Mark composition applications (and their drafts) that no approved composition stamp still
 * produces as stale. Runs even when no composition stamp is approved, because suspending or
 * superseding the last one must still retire its surviving applications.
 */
function staleUnmatchedApplications(db: DatabaseSync, selected: ReadonlySet<number> | null, activeIds: ReadonlySet<string>): { stale: number; changed: boolean } {
  const current = db.prepare(`
    SELECT stamp_applications.id, stamp_applications.ability_version_id FROM stamp_applications
    JOIN stamps ON stamps.id = stamp_applications.stamp_id AND stamps.revision = stamp_applications.stamp_revision
    WHERE stamps.kind = 'composition' AND stamp_applications.status IN ('active', 'blocked')
  `).all() as Array<{ id: string; ability_version_id: number }>;
  let stale = 0;
  let changed = false;
  for (const application of current) {
    if (selected && !selected.has(application.ability_version_id)) continue;
    if (activeIds.has(application.id)) continue;
    const appChanged = Number(db.prepare("UPDATE stamp_applications SET status = 'stale', reason_code = 'NO_LONGER_MATCHES', updated_at = ? WHERE id = ? AND status IN ('active', 'blocked')").run(new Date().toISOString(), application.id).changes);
    const draftChanged = Number(db.prepare("UPDATE assembly_drafts SET status = 'stale', diagnostic_json = ?, updated_at = ? WHERE composition_application_id = ? AND status <> 'stale'").run(JSON.stringify({ reason_code: "NO_LONGER_MATCHES" }), new Date().toISOString(), application.id).changes);
    stale += appChanged;
    changed ||= appChanged > 0 || draftChanged > 0;
  }
  return { stale, changed };
}

export function applyCompositionStamps(db: DatabaseSync, options: { ability_version_ids?: number[]; create_escalation: EscalationWriter }): AssemblyResult {
  const selected = options.ability_version_ids ? new Set(options.ability_version_ids) : null;
  const stampRows = db.prepare("SELECT id, revision, definition_json, definition_hash, approval_batch_id FROM stamps WHERE status = 'approved' AND kind = 'composition' ORDER BY id, revision").all() as StampRow[];
  // With nothing to match, the per-ability leaf prewarm and schema validator are pure cost.
  if (stampRows.length === 0) {
    const cleanup = staleUnmatchedApplications(db, selected, new Set());
    return { proposed: 0, blocked: 0, stale: cleanup.stale, changed: cleanup.changed };
  }
  activeLeavesCache.clear();
  try {
    return assembleApproved(db, options, selected, stampRows);
  } finally {
    activeLeavesCache.clear();
  }
}

function assembleApproved(db: DatabaseSync, options: { create_escalation: EscalationWriter }, selected: ReadonlySet<number> | null, stampRows: StampRow[]): AssemblyResult {
  const abilities = (db.prepare("SELECT id, faction_id, ability_id, source_hash, source_text, source_type, fragments_json FROM abilities WHERE current = 1 ORDER BY id").all() as AbilityRow[]).filter((ability) => !selected || selected.has(ability.id));
  for (const ability of abilities) activeLeavesCache.set(ability.id, activeLeaves(db, ability.id));
  const matches: CompleteMatch[] = [];
  for (const stamp of stampRows) {
    const definition = validateStampDefinition(JSON.parse(stamp.definition_json));
    if (definition.kind !== "composition" || hashJson(definition) !== stamp.definition_hash) throw new Error(`Composition stamp ${stamp.id}@${stamp.revision} failed its definition hash.`);
    for (const ability of abilities) matches.push(...completeMatches(stamp, definition, ability));
  }
  const byAbility = new Map<number, CompleteMatch[]>();
  for (const match of matches) {
    const group = byAbility.get(match.ability.id) ?? [];
    group.push(match);
    byAbility.set(match.ability.id, group);
  }
  const schemaHash = schemaTreeHash();
  const validator = createValidator();
  let proposed = 0;
  let blocked = 0;
  let changed = false;
  const activeIds = new Set<string>();
  const incorrectAuditApplications = new Set((db.prepare(`
    SELECT application_id FROM stamp_audit_decisions
    WHERE verdict = 'incorrect' AND scope = 'occurrence'
  `).all() as Array<{ application_id: string }>).map((audit) => audit.application_id));
  for (const group of byAbility.values()) {
    const outputs = new Set(group.map((match) => {
      try {
        return hashJson({ graph: instantiateTemplate(match.variant.graph_template, match.bindings), mechanics: match.variant.mechanics_template === null ? null : instantiateTemplate(match.variant.mechanics_template, match.bindings) });
      } catch (error) {
        return hashJson({ error: error instanceof Error ? error.message : String(error) });
      }
    }));
    for (const match of group) activeIds.add(applicationId(match));
    if (group.some((match) => incorrectAuditApplications.has(applicationId(match)))) {
      const now = new Date().toISOString();
      for (const match of group) {
        const dependencies = {
          assembler_version: "round5c/stamp-assembler/v1",
          stamp: { id: match.stamp.id, revision: match.stamp.revision, definition_hash: match.stamp.definition_hash },
          source_hash: match.ability.source_hash,
          leaf_annotation_ids: match.leaf_dependencies,
          schema_hash: schemaHash,
        };
        const applicationChanged = persistCompositionApplication(
          db,
          match,
          applicationId(match),
          hashJson({ dependencies, bindings: match.bindings }),
          dependencies,
          "blocked",
          "AUDIT_OCCURRENCE_INCORRECT",
        );
        changed ||= applicationChanged;
        const draftChanged = db.prepare(`
          UPDATE assembly_drafts
          SET status = 'blocked', verifier_run_id = NULL, diagnostic_json = ?, updated_at = ?
          WHERE composition_application_id = ? AND status <> 'blocked'
        `).run(
          JSON.stringify({ reason_code: "AUDIT_OCCURRENCE_INCORRECT" }),
          now,
          applicationId(match),
        );
        changed ||= draftChanged.changes > 0;
      }
      const match = group[0]!;
      options.create_escalation("SOURCE_AMBIGUITY", {
        stamp_id: match.stamp.id,
        revision: match.stamp.revision,
        variant_id: match.variant.id,
        audit_application_id: applicationId(match),
        correction_required: true,
      }, [{ ability_version_id: match.ability.id, source_hash: match.ability.source_hash }]);
      blocked += 1;
      continue;
    }
    if (outputs.size > 1) {
      for (const match of group) {
        const dependencies = { assembler_version: "round5c/stamp-assembler/v1", stamp: { id: match.stamp.id, revision: match.stamp.revision, definition_hash: match.stamp.definition_hash }, source_hash: match.ability.source_hash, leaf_annotation_ids: match.leaf_dependencies, schema_hash: schemaHash };
        const applicationChanged = persistCompositionApplication(db, match, applicationId(match), hashJson({ dependencies, bindings: match.bindings }), dependencies, "blocked", "SOURCE_AMBIGUITY");
        changed = changed || applicationChanged;
      }
      const match = group[0]!;
      options.create_escalation("SOURCE_AMBIGUITY", { ability_version_id: match.ability.id, complete_outputs: outputs.size, supporting_stamps: group.map((candidate) => `${candidate.stamp.id}@${candidate.stamp.revision}`).sort() }, [{ ability_version_id: match.ability.id, source_hash: match.ability.source_hash }]);
      blocked += 1;
      continue;
    }
    const result = assembleOne(db, group, schemaHash, validator, options.create_escalation);
    proposed += result.proposed;
    blocked += result.blocked;
    changed ||= result.changed;
  }
  const cleanup = staleUnmatchedApplications(db, selected, activeIds);
  return { proposed, blocked, stale: cleanup.stale, changed: changed || cleanup.changed };
}

type DraftVerificationRow = {
  id: string;
  composition_application_id: string;
  graph_json: string;
  mechanics_json: string | null;
  rendered_text: string | null;
  inputs_hash: string;
  schema_hash: string;
  status: "proposed" | "accepted" | "blocked" | "stale";
  verifier_run_id: number | null;
  diagnostic_json: string;
  dependencies_json: string;
  application_status: string;
  stamp_id: string;
  stamp_revision: number;
  stamp_status: string;
  stamp_definition_hash: string;
  ability_version_id: number;
  source_hash: string;
  source_text: string;
  faction_id: string;
  ability_id: string;
  bindings_json: string;
  current: number;
};

export type DraftVerificationSnapshot = {
  draft_id: string;
  evidence_hash: string;
  source_hash: string;
  graph_hash: string;
  mechanics_hash: string;
  schema_hash: string;
  dependencies_hash: string;
  inputs_hash: string;
  rendered_text: string;
};

export class DraftVerificationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DraftVerificationError";
    this.status = status;
  }
}

function verificationRow(db: DatabaseSync, draftId: string): DraftVerificationRow {
  const row = db.prepare(`
    SELECT assembly_drafts.id, assembly_drafts.composition_application_id, assembly_drafts.graph_json,
      assembly_drafts.mechanics_json, assembly_drafts.rendered_text, assembly_drafts.inputs_hash,
      assembly_drafts.schema_hash, assembly_drafts.status, assembly_drafts.verifier_run_id,
      assembly_drafts.diagnostic_json, stamp_applications.dependencies_json,
      stamp_applications.bindings_json, stamp_applications.status AS application_status,
      stamp_applications.stamp_id, stamp_applications.stamp_revision, stamps.status AS stamp_status,
      stamps.definition_hash AS stamp_definition_hash, abilities.id AS ability_version_id,
      abilities.faction_id, abilities.ability_id, abilities.source_hash, abilities.source_text,
      abilities.current
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE assembly_drafts.id = ?
  `).get(draftId) as DraftVerificationRow | undefined;
  if (!row) throw new DraftVerificationError(404, `Unknown draft ${draftId}.`);
  return row;
}

function assertApplicationSupport(db: DatabaseSync, applicationId: string, expected?: Record<string, unknown>): void {
  const row = db.prepare(`
    SELECT stamp_applications.status, stamp_applications.stamp_id, stamp_applications.stamp_revision,
      stamp_applications.variant_id, stamp_applications.bindings_json, stamp_applications.dependencies_json,
      stamps.status AS stamp_status, stamps.definition_hash, abilities.current
    FROM stamp_applications
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE stamp_applications.id = ?
  `).get(applicationId) as { status: string; stamp_id: string; stamp_revision: number; variant_id: string; bindings_json: string; dependencies_json: string; stamp_status: string; definition_hash: string; current: number } | undefined;
  if (!row || row.status !== "active" || row.stamp_status !== "approved" || row.current !== 1) {
    throw new DraftVerificationError(409, `Draft support ${applicationId} is no longer current and approved.`);
  }
  const dependencies = JSON.parse(row.dependencies_json) as { leaf_annotation_ids?: unknown };
  if (!Array.isArray(dependencies.leaf_annotation_ids) || dependencies.leaf_annotation_ids.some((id) => typeof id !== "number" || !annotationHasEffectiveAuthority(db, id))) {
    throw new DraftVerificationError(409, `Draft support ${applicationId} has a stale leaf dependency.`);
  }
  if (expected && (
    expected.stamp_id !== row.stamp_id
    || expected.stamp_revision !== row.stamp_revision
    || expected.definition_hash !== row.definition_hash
    || expected.variant_id !== row.variant_id
    || hashJson(expected.bindings) !== hashJson(JSON.parse(row.bindings_json))
    || hashJson(expected.leaf_annotation_ids) !== hashJson(dependencies.leaf_annotation_ids)
  )) throw new DraftVerificationError(409, `Draft support ${applicationId} no longer matches its pinned provenance.`);
}

export function draftVerificationSnapshot(db: DatabaseSync, draftId: string): DraftVerificationSnapshot {
  const row = verificationRow(db, draftId);
  if (row.mechanics_json === null || row.rendered_text === null) throw new DraftVerificationError(422, "A blocked DSL gap cannot be verified.");
  if (row.status === "stale" || row.application_status !== "active" || row.stamp_status !== "approved" || row.current !== 1) {
    throw new DraftVerificationError(409, "Draft authority is stale.");
  }
  if (row.schema_hash !== schemaTreeHash()) throw new DraftVerificationError(409, "Draft schema snapshot is stale.");
  const dependencies = JSON.parse(row.dependencies_json) as {
    source_hash?: unknown;
    stamp?: { definition_hash?: unknown };
    leaf_annotation_ids?: unknown;
    equivalent_supports?: unknown;
    entity?: unknown;
  };
  if (dependencies.source_hash !== row.source_hash || dependencies.stamp?.definition_hash !== row.stamp_definition_hash) {
    throw new DraftVerificationError(409, "Draft source or rule dependency is stale.");
  }
  const entity = parseEntityDependency(dependencies.entity);
  if (!entity || entity.faction_id !== row.faction_id || entity.ability_id !== row.ability_id) {
    throw new DraftVerificationError(409, "Draft entity dependency is stale.");
  }
  try {
    const resolved = resolveAbilityEntity(round5cDataRoot(), row.faction_id, row.ability_id);
    if (hashJson(resolved.entry) !== entity.entry_hash) {
      throw new DraftVerificationError(409, "Draft entity dependency is stale.");
    }
  } catch (error) {
    if (error instanceof DraftVerificationError) throw error;
    throw new DraftVerificationError(409, "Draft entity dependency is stale.");
  }
  if (!Array.isArray(dependencies.leaf_annotation_ids) || dependencies.leaf_annotation_ids.some((id) => typeof id !== "number" || !annotationHasEffectiveAuthority(db, id))) {
    throw new DraftVerificationError(409, "A leaf dependency is no longer authoritative.");
  }
  if (dependencies.equivalent_supports !== undefined) {
    if (!Array.isArray(dependencies.equivalent_supports)) throw new DraftVerificationError(409, "Draft support provenance is malformed.");
    for (const support of dependencies.equivalent_supports) {
      if (!support || typeof support !== "object" || Array.isArray(support) || !("application_id" in support) || typeof support.application_id !== "string") {
        throw new DraftVerificationError(409, "Draft support provenance is malformed.");
      }
      assertApplicationSupport(db, support.application_id, support as Record<string, unknown>);
    }
  } else {
    assertApplicationSupport(db, row.composition_application_id);
  }
  const graph = JSON.parse(row.graph_json) as Record<string, unknown>;
  const mechanics = JSON.parse(row.mechanics_json) as Record<string, unknown>;
  if (hashJson({ dependencies, bindings: JSON.parse(row.bindings_json), graph, mechanics }) !== row.inputs_hash) {
    throw new DraftVerificationError(409, "Draft input snapshot is stale.");
  }
  const validator = createValidator();
  const validate = validator.getSchema(ABILITY_SCHEMA_ID);
  if (!validate || !validate(mechanics)) throw new DraftVerificationError(409, "Draft mechanics no longer pass the current ability schema.");
  const lint = lintCanonical(mechanics.effect);
  if (!lint.canonical) throw new DraftVerificationError(409, "Draft mechanics no longer pass canonical lint.");
  if (describeAbility(mechanics as never) !== row.rendered_text) throw new DraftVerificationError(409, "Draft rendering no longer matches its mechanics.");
  const snapshot = {
    draft_id: row.id,
    source_hash: row.source_hash,
    graph_hash: hashJson(graph),
    mechanics_hash: hashJson(mechanics),
    schema_hash: row.schema_hash,
    dependencies_hash: hashJson(dependencies),
    inputs_hash: row.inputs_hash,
    rendered_text: row.rendered_text,
  };
  return { ...snapshot, evidence_hash: hashJson(snapshot) };
}

function verificationResult(output: unknown, draftId: string): { evidence_hash: string; faithful: boolean; severity: "ok" | "minor" | "wrong"; findings: unknown[] } {
  if (!output || typeof output !== "object" || Array.isArray(output) || !("items" in output) || !Array.isArray(output.items)) {
    throw new DraftVerificationError(422, "Verifier output must contain response items.");
  }
  const matches = output.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item) && item.item_id === draftId));
  if (matches.length !== 1) throw new DraftVerificationError(422, "Verifier output must contain the draft exactly once.");
  const item = matches[0]!;
  if (typeof item.evidence_hash !== "string" || !item.result || typeof item.result !== "object" || Array.isArray(item.result)) {
    throw new DraftVerificationError(422, "Verifier result is malformed.");
  }
  const result = item.result as Record<string, unknown>;
  if (typeof result.faithful !== "boolean" || result.severity !== "ok" && result.severity !== "minor" && result.severity !== "wrong" || !Array.isArray(result.findings)) {
    throw new DraftVerificationError(422, "Verifier fidelity verdict is malformed.");
  }
  return { evidence_hash: item.evidence_hash, faithful: result.faithful, severity: result.severity, findings: result.findings };
}

export function recordDraftVerification(
  db: DatabaseSync,
  body: { draft_id: string; verifier_run_id: number; bump_revision?: boolean },
  createEscalation: EscalationWriter,
): { draft_id: string; status: "accepted" | "blocked"; evidence_hash: string; changed: boolean } {
  if (!body.draft_id?.trim() || !Number.isSafeInteger(body.verifier_run_id) || body.verifier_run_id < 1) throw new DraftVerificationError(422, "draft_id and verifier_run_id are required.");
  return withTransaction(db, () => {
    const snapshot = draftVerificationSnapshot(db, body.draft_id);
    const row = verificationRow(db, body.draft_id);
    const run = db.prepare("SELECT status, output_json FROM model_runs WHERE id = ?").get(body.verifier_run_id) as { status: string; output_json: string | null } | undefined;
    if (!run || run.status !== "completed" || run.output_json === null) throw new DraftVerificationError(422, "Verifier run is incomplete.");
    const reused = db.prepare(`
      SELECT 1 FROM stamps
      WHERE model_run_id = ? OR challenge_run_id = ?
      LIMIT 1
    `).get(body.verifier_run_id, body.verifier_run_id);
    if (reused) throw new DraftVerificationError(422, "Draft verification must use a distinct model invocation.");
    const result = verificationResult(JSON.parse(run.output_json), body.draft_id);
    if (result.evidence_hash !== snapshot.evidence_hash) throw new DraftVerificationError(409, "Verifier evidence is stale.");
    const accepted = result.faithful && result.severity === "ok";
    const status = accepted ? "accepted" : "blocked";
    const diagnostic = { reason_code: accepted ? null : "MODEL_ERROR", evidence_hash: snapshot.evidence_hash, verdict: result };
    const changed = row.status !== status || row.verifier_run_id !== body.verifier_run_id || hashJson(JSON.parse(row.diagnostic_json)) !== hashJson(diagnostic);
    if (changed) {
      db.prepare(`
        UPDATE assembly_drafts SET status = ?, verifier_run_id = ?, diagnostic_json = ?, updated_at = ?
        WHERE id = ? AND status <> 'stale'
      `).run(status, body.verifier_run_id, JSON.stringify(diagnostic), new Date().toISOString(), body.draft_id);
      if (body.bump_revision !== false) bumpWorkbenchRevision(db);
    }
    if (!accepted) {
      createEscalation("MODEL_ERROR", { draft_id: body.draft_id, evidence_hash: snapshot.evidence_hash, verdict: result }, [{ ability_version_id: row.ability_version_id, source_hash: row.source_hash, draft_id: body.draft_id }]);
    }
    return { draft_id: body.draft_id, status, evidence_hash: snapshot.evidence_hash, changed };
  });
}

export function listDrafts(db: DatabaseSync, options: { status?: string; cursor?: string } = {}): { items: Array<Record<string, unknown>>; next_cursor: string | null; total: number } {
  const allowed: Record<string, true> = { proposed: true, accepted: true, blocked: true, stale: true };
  if (options.status && !allowed[options.status]) throw new Error("Unknown draft status filter.");
  const status = options.status ?? null;
  let boundary: { created_at: string; id: string } | null = null;
  let snapshotRowid = Number((db.prepare("SELECT coalesce(max(rowid), 0) AS value FROM assembly_drafts").get() as { value: number }).value);
  let snapshotTotal: number | null = null;
  if (options.cursor) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
      if (
        decoded
        && typeof decoded === "object"
        && !Array.isArray(decoded)
        && "kind" in decoded && decoded.kind === "drafts"
        && "status" in decoded && decoded.status === status
        && "created_at" in decoded && typeof decoded.created_at === "string"
        && "id" in decoded && typeof decoded.id === "string"
        && "snapshot_rowid" in decoded && Number.isSafeInteger(decoded.snapshot_rowid) && Number(decoded.snapshot_rowid) >= 0
        && "total" in decoded && Number.isSafeInteger(decoded.total) && Number(decoded.total) >= 0
      ) {
        boundary = { created_at: decoded.created_at, id: decoded.id };
        snapshotRowid = Number(decoded.snapshot_rowid);
        snapshotTotal = Number(decoded.total);
      }
    } catch {
      // Report the stable domain error below.
    }
    if (boundary === null) throw new Error("Draft cursor is malformed.");
  }
  const filters: string[] = ["assembly_drafts.rowid <= ?"];
  const parameters: Array<string | number> = [snapshotRowid];
  if (status !== null) {
    filters.push("assembly_drafts.status = ?");
    parameters.push(status);
  }
  if (boundary !== null) {
    filters.push("(assembly_drafts.created_at < ? OR (assembly_drafts.created_at = ? AND assembly_drafts.id > ?))");
    parameters.push(boundary.created_at, boundary.created_at, boundary.id);
  }
  const rows = db.prepare(`
    SELECT assembly_drafts.*, stamp_applications.ability_version_id, stamp_applications.stamp_id,
      stamp_applications.stamp_revision, abilities.faction_id, abilities.ability_id, abilities.source_hash
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY assembly_drafts.created_at DESC, assembly_drafts.id
    LIMIT 21
  `).all(...parameters) as Array<Record<string, unknown> & {
    id: string;
    created_at: string;
    graph_json: string;
    mechanics_json: string | null;
    diagnostic_json: string;
  }>;
  const page = rows.slice(0, 20);
  const items = page.map(({ graph_json, mechanics_json, diagnostic_json, ...row }) => ({
    ...row,
    graph: JSON.parse(graph_json),
    mechanics: mechanics_json === null ? null : JSON.parse(mechanics_json),
    diagnostic: JSON.parse(diagnostic_json),
  }));
  const last = page.at(-1);
  const total = snapshotTotal ?? Number((db.prepare(`
    SELECT count(*) AS total FROM assembly_drafts
    WHERE rowid <= ? ${status === null ? "" : "AND status = ?"}
  `).get(snapshotRowid, ...(status === null ? [] : [status])) as { total: number }).total);
  return {
    items,
    next_cursor: rows.length > 20 && last
      ? Buffer.from(JSON.stringify({
        kind: "drafts",
        status,
        created_at: last.created_at,
        id: last.id,
        snapshot_rowid: snapshotRowid,
        total,
      }), "utf8").toString("base64url")
      : null,
    total,
  };
}

export function getDraft(db: DatabaseSync, draftId: string): Record<string, unknown> {
  const page = db.prepare(`
    SELECT assembly_drafts.*, stamp_applications.ability_version_id, stamp_applications.stamp_id,
      stamp_applications.stamp_revision, stamp_applications.dependencies_json,
      abilities.faction_id, abilities.ability_id, abilities.source_hash, abilities.source_text
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE assembly_drafts.id = ?
  `).get(draftId) as (Record<string, unknown> & { graph_json: string; mechanics_json: string | null; diagnostic_json: string; dependencies_json: string }) | undefined;
  if (!page) throw new Error(`Unknown draft ${draftId}.`);
  const { graph_json, mechanics_json, diagnostic_json, dependencies_json, ...row } = page;
  return {
    ...row,
    graph: JSON.parse(graph_json),
    mechanics: mechanics_json === null ? null : JSON.parse(mechanics_json),
    diagnostic: JSON.parse(diagnostic_json),
    dependencies: JSON.parse(dependencies_json),
    publication: row.status === "accepted" ? publicationGuidance(db, draftId, String(row.faction_id)) : null,
  };
}

/**
 * The guarded CLI commands that publish an accepted draft, plus its latest publication batch.
 * The browser never writes tracked data; an accepted draft alone is not authored data.
 */
function publicationGuidance(db: DatabaseSync, draftId: string, factionId: string): Record<string, unknown> {
  const batches = db.prepare(`
    SELECT publication_batches.id, publication_batches.state, publication_batches.preview_hash, publication_batches.manifest_json
    FROM publication_batches, json_each(publication_batches.manifest_json, '$.drafts') AS draft
    WHERE json_extract(draft.value, '$.draft_id') = ?
    ORDER BY publication_batches.created_at DESC, publication_batches.id DESC LIMIT 1
  `).get(draftId) as { id: string; state: string; preview_hash: string; manifest_json: string } | undefined;
  const manifest = batches ? JSON.parse(batches.manifest_json) as { receipt?: unknown; relative_path?: string } : null;
  return {
    prepare: `npm run round5c:prepare-publication -- ${factionId} ${draftId} [--reauthor]`,
    publish: batches ? `npm run round5c:publish -- ${batches.id} ${batches.preview_hash}` : "npm run round5c:publish -- <batch-id> <preview-hash>",
    latest_batch: batches ? { batch_id: batches.id, state: batches.state, preview_hash: batches.preview_hash, relative_path: manifest?.relative_path ?? null, receipt: manifest?.receipt ?? null } : null,
  };
}

/** What one set of mechanics would become for an ability, without persisting anything. */
export type MechanicsRender = { entry: Record<string, unknown> | null; rendered_text: string | null; errors: string[] };

let previewValidator: Ajv | null = null;

/**
 * Render instantiated mechanics through the same entity, schema, lint, and describer steps a
 * draft uses, for review before approval. Failures come back as messages, never as writes.
 */
export function renderMechanicsPreview(factionId: string, abilityId: string, mechanics: unknown): MechanicsRender {
  if (mechanics === null || mechanics === undefined) return { entry: null, rendered_text: null, errors: ["No mechanics mapping: this rule would produce a DSL_GAP draft."] };
  let envelope: MechanicsEnvelope;
  let resolved: ResolvedAbilityEntity;
  try {
    envelope = mechanicsEnvelope(mechanics);
    resolved = resolveAbilityEntity(round5cDataRoot(), factionId, abilityId);
  } catch (error) {
    return { entry: null, rendered_text: null, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const entry = buildRepairedEntry(resolved.entry, envelope.effect, envelope.scope, envelope.behavior ?? undefined, { trigger: envelope.trigger, usage: envelope.usage, applies_to: envelope.applies_to });
  if (Object.hasOwn(resolved.entry, "community_notes")) entry.community_notes = resolved.entry.community_notes;
  else delete entry.community_notes;
  if (envelope.behavior === null) delete entry.behavior;
  const errors: string[] = [];
  previewValidator ??= createValidator();
  const validate = previewValidator.getSchema(ABILITY_SCHEMA_ID);
  if (validate && !validate(entry)) errors.push(...(validate.errors ?? []).map((issue) => `${issue.instancePath || "/"} ${issue.message ?? "invalid"}`));
  const lint = lintCanonical(entry.effect);
  if (!lint.canonical) errors.push(...lint.issues);
  let rendered: string | null = null;
  try {
    rendered = describeAbility(entry as never);
  } catch (error) {
    errors.push(`Describer failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { entry, rendered_text: rendered, errors };
}

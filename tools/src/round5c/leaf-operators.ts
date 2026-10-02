import type { DatabaseSync } from "node:sqlite";

import { assertReviewer, requireHuman, type Actor } from "./authority.js";
import { currentFamilyVersion, validateFingerprint } from "./contracts.js";
import { withTransaction } from "./db.js";
import { activeSurface, addMember, applySurface, finish, fingerprintRow, insertSurface, leafSurface, LeafError, newBatch, type ApplyReport } from "./leaves.js";
import { assertResolved } from "./placeholders.js";
import { parseScope, ScopeError, scopeJson } from "./surface-scope.js";

/**
 * A leaf operator is one human decision that a worded template means one semantic family whose
 * named parameters are read from the wording itself: "{subject} is eligible to {acts} in a turn in
 * which it {moves}" with `subject` spelled "this unit" (this-unit) or "this model" (this-model).
 * Every slot lists the exact spellings the decision covers and the parameter value each one
 * supplies, so the occurrence's own words bind the operand, never a neighbouring example. Slots
 * naming the same parameter fill one list together, in template order ("**{a}** or **{b}**").
 *
 * The operator expands to the finite set of its spellings. Each spelling becomes an ordinary
 * scoped surface (`leaf_surfaces.operator_id` names the operator) under the operator's scope, so
 * matching, scope checks, blocking, reapplication and undo are those of any decided surface, and
 * every derived leaf traces to this decision through its surface. A spelling whose wording another
 * surface already decides with the same meaning keeps that surface; a different meaning refuses
 * the whole operator.
 */

export type OperatorSlot = { parameter: string; spellings: Record<string, unknown> };

export type OperatorDefinition = {
  family_id: string;
  family_version: number;
  template: string;
  slots: Record<string, OperatorSlot>;
  fixed: Record<string, unknown>;
  scope: unknown;
  /** The slot pairings decided, when not every combination of spellings is (multi-slot alternatives). */
  combinations?: Array<Record<string, string>>;
};

export type OperatorSpelling = {
  wording: string;
  surface: string;
  parameters: Record<string, unknown>;
  /** The spelling each slot took in this wording. */
  bindings: Record<string, string>;
};

export type OperatorSpellingReport = Omit<OperatorSpelling, "parameters"> & {
  fingerprint_id: string;
  surface_id: number;
  /** `created`: a new surface of this operator; `kept`: an earlier surface already decided it. */
  surface_status: "created" | "kept";
  applied: number;
  already: number;
  out_of_scope: number;
  blocked: ApplyReport["blocked"];
};

export type OperatorReport = {
  batch_id: string;
  operator_id: number;
  applied: number;
  spellings: OperatorSpellingReport[];
};

const SLOT = /\{([a-z][a-z0-9_]*)\}/gu;
const MAX_SPELLINGS = 512;
const EDGE_PUNCTUATION = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new LeafError(422, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

/** Validate an operator decision into its stored definition; nothing is defaulted silently. */
export function operatorDefinition(value: unknown): OperatorDefinition {
  const input = record(value, "operator");
  if (typeof input.family_id !== "string" || !input.family_id.trim()) throw new LeafError(422, "operator.family_id is required.");
  const familyVersion = input.family_version === undefined ? currentFamilyVersion(input.family_id) : Number(input.family_version);
  if (!Number.isSafeInteger(familyVersion) || familyVersion < 1) throw new LeafError(422, "operator.family_version must be a positive integer.");
  if (typeof input.template !== "string" || input.template !== input.template.trim() || !input.template) throw new LeafError(422, "operator.template must be nonblank wording without edge spaces.");
  const used = [...input.template.matchAll(SLOT)].map((match) => match[1]!);
  if (used.length === 0) throw new LeafError(422, "An operator template names at least one {slot}; a fixed wording is a surface.");
  if (new Set(used).size !== used.length) throw new LeafError(422, "Each operator slot occurs once in the template.");
  if (/[{}]/u.test(input.template.replace(SLOT, ""))) throw new LeafError(422, "operator.template has a malformed {slot}.");
  const slotsInput = record(input.slots, "operator.slots");
  const declared = Object.keys(slotsInput);
  const missing = used.filter((name) => !declared.includes(name));
  const unused = declared.filter((name) => !used.includes(name));
  if (missing.length || unused.length) throw new LeafError(422, `Operator slots and template disagree: missing ${missing.join(", ") || "none"}, unused ${unused.join(", ") || "none"}.`);
  const fixed = input.fixed === undefined ? {} : record(input.fixed, "operator.fixed");
  const parameters = new Set<string>();
  const slots: Record<string, OperatorSlot> = {};
  for (const name of used) {
    const slot = record(slotsInput[name], `operator.slots.${name}`);
    if (typeof slot.parameter !== "string" || !slot.parameter) throw new LeafError(422, `operator.slots.${name}.parameter is required.`);
    if (Object.hasOwn(fixed, slot.parameter)) throw new LeafError(422, `Parameter ${slot.parameter} is supplied twice.`);
    parameters.add(slot.parameter);
    const spellings = record(slot.spellings, `operator.slots.${name}.spellings`);
    if (Object.keys(spellings).length === 0) throw new LeafError(422, `operator.slots.${name}.spellings is empty.`);
    for (const spelling of Object.keys(spellings)) {
      if (!spelling.trim() || spelling !== spelling.trim() || /[{}]/u.test(spelling)) throw new LeafError(422, `Slot ${name} spelling "${spelling}" must be nonblank wording without edge spaces or braces.`);
    }
    slots[name] = { parameter: slot.parameter, spellings };
  }
  let scope: unknown = null;
  try {
    const parsed = scopeJson(parseScope(input.scope));
    scope = parsed === null ? null : JSON.parse(parsed);
  } catch (error) {
    if (error instanceof ScopeError) throw new LeafError(422, error.message);
    throw error;
  }
  let combinations: Array<Record<string, string>> | undefined;
  if (input.combinations !== undefined) {
    if (!Array.isArray(input.combinations) || input.combinations.length === 0) throw new LeafError(422, "operator.combinations must be a nonempty list.");
    combinations = input.combinations.map((entry, index) => {
      const combination = record(entry, `operator.combinations[${index}]`);
      const keys = Object.keys(combination);
      if (keys.length !== used.length || used.some((name) => typeof combination[name] !== "string" || !Object.hasOwn(slots[name]!.spellings, combination[name] as string))) {
        throw new LeafError(422, `operator.combinations[${index}] must give every slot one of its declared spellings.`);
      }
      return combination as Record<string, string>;
    });
  }
  return { family_id: input.family_id, family_version: familyVersion, template: input.template, slots, fixed, scope, ...(combinations ? { combinations } : {}) };
}

/** Every wording the operator covers, with the parameters its slot spellings supply. */
export function operatorSpellings(definition: OperatorDefinition): OperatorSpelling[] {
  const names = [...definition.template.matchAll(SLOT)].map((match) => match[1]!);
  const total = definition.combinations?.length ?? names.reduce((product, name) => product * Object.keys(definition.slots[name]!.spellings).length, 1);
  if (total > MAX_SPELLINGS) throw new LeafError(422, `The operator expands to ${total} spellings; at most ${MAX_SPELLINGS} are allowed.`);
  let partial: Array<{ bindings: Record<string, string> }> = [{ bindings: {} }];
  if (definition.combinations) partial = definition.combinations.map((bindings) => ({ bindings }));
  else {
    for (const name of names) {
      partial = partial.flatMap((item) => Object.keys(definition.slots[name]!.spellings).map((spelling) => ({ bindings: { ...item.bindings, [name]: spelling } })));
    }
  }
  const seen = new Map<string, string>();
  return partial.map(({ bindings }) => {
    const wording = definition.template.replace(SLOT, (_, name: string) => bindings[name]!);
    const surface = leafSurface(wording);
    const previous = seen.get(surface);
    if (previous !== undefined) throw new LeafError(422, `Spellings "${previous}" and "${wording}" are the same surface.`);
    seen.set(surface, wording);
    const parameters: Record<string, unknown> = { ...definition.fixed };
    const shared = new Map<string, number>();
    for (const name of names) shared.set(definition.slots[name]!.parameter, (shared.get(definition.slots[name]!.parameter) ?? 0) + 1);
    for (const name of names) {
      const { parameter } = definition.slots[name]!;
      const value = definition.slots[name]!.spellings[bindings[name]!];
      // Slots sharing one parameter list their values together, in template order ("**X** or **Y**").
      parameters[parameter] = shared.get(parameter)! > 1 ? [...(parameters[parameter] as unknown[] ?? []), ...(Array.isArray(value) ? value : [value])] : value;
    }
    return { wording, surface, parameters, bindings };
  });
}

/**
 * Decide an operator and apply it: record it, instantiate each spelling as a scoped surface linked
 * to it, and apply those surfaces corpus-wide, longest wording first so a longer spelling claims its
 * bytes before a shorter one inside it. Refused whole when any spelling's wording already means
 * something else, or any parameter set fails its family.
 */
export function confirmOperator(db: DatabaseSync, value: unknown, actor: Actor): OperatorReport {
  const input = record(value, "operator");
  requireHuman(actor, "decide an operator");
  assertReviewer(actor, input.reviewer);
  const definition = operatorDefinition(input);
  const spellings = operatorSpellings(definition);
  return withTransaction(db, () => {
    const meanings = spellings.map((spelling) => {
      try {
        assertResolved(spelling.parameters);
        const id = validateFingerprint(db, definition.family_id, spelling.parameters, definition.family_version, spelling.wording.replace(EDGE_PUNCTUATION, ""));
        return fingerprintRow(db, id);
      } catch (error) {
        if (error instanceof LeafError) throw error;
        throw new LeafError(422, `"${spelling.wording}": ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    const conflicts = spellings.flatMap((spelling, index) => {
      const existing = activeSurface(db, spelling.surface);
      return existing && existing.fingerprint_id !== meanings[index]!.id ? [`"${spelling.surface}" (surface ${existing.id})`] : [];
    });
    if (conflicts.length) throw new LeafError(409, `Already decided with another meaning: ${conflicts.join("; ")}.`);
    const scope = definition.scope === null ? null : JSON.stringify(definition.scope);
    const batchId = newBatch(db, actor.reviewer, { action: "confirm-operator", operator: definition });
    const operatorId = Number(db.prepare(`
      INSERT INTO leaf_operators (family_id, family_version, definition_json, status, authority_kind, batch_id, created_at)
      VALUES (?, ?, ?, 'active', 'human', ?, ?)
    `).run(definition.family_id, definition.family_version, JSON.stringify(definition), batchId, new Date().toISOString()).lastInsertRowid);
    addMember(db, batchId, "leaf-operator-created", operatorId);
    const touched = new Set<number>();
    const reports: OperatorSpellingReport[] = [];
    const order = spellings.map((spelling, index) => ({ spelling, meaning: meanings[index]! }))
      .sort((left, right) => right.spelling.surface.length - left.spelling.surface.length || left.spelling.surface.localeCompare(right.spelling.surface));
    for (const { spelling, meaning } of order) {
      const { parameters: _parameters, ...named } = spelling;
      const existing = activeSurface(db, spelling.surface);
      // An earlier decision of the same wording and meaning stands as it was decided.
      if (existing) {
        reports.push({ ...named, fingerprint_id: meaning.id, surface_id: existing.id, surface_status: "kept", applied: 0, already: 0, out_of_scope: 0, blocked: [] });
        continue;
      }
      const row = insertSurface(db, spelling.surface, meaning.id, batchId, "human", null, scope, operatorId);
      const report = applySurface(db, row, actor.reviewer, batchId);
      for (const id of report.touched) touched.add(id);
      reports.push({ ...named, fingerprint_id: meaning.id, surface_id: row.id, surface_status: "created", applied: report.applied, already: report.already, out_of_scope: report.out_of_scope ?? 0, blocked: report.blocked });
    }
    finish(db, touched);
    return { batch_id: batchId, operator_id: operatorId, applied: reports.reduce((sum, item) => sum + item.applied, 0), spellings: reports };
  });
}

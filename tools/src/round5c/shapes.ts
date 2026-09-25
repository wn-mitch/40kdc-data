import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { compilationInputsHash } from "./compiled.js";
import { compileLeaves, type CompileLeaf, type Compiled } from "./compile.js";
import { getCurrentCoverage } from "./coverage.js";
import { bumpWorkbenchRevision, withTransaction } from "./db.js";
import { checkEntry, entryWithMechanics, resolveAbilityEntity, round5cDataRoot } from "./entries.js";
import { untiledRuns } from "./leaves.js";

/**
 * Shapes: sources fully described by leaves, grouped by the order of their leaf roles and
 * families. Every member of a shape compiles by the same rules, so a reviewer checks a few
 * renders and approves the shape for all of them at once.
 */

export class ShapeError extends Error {
  readonly status: number;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "ShapeError";
    this.status = status;
  }
}

type Member = { id: number; faction_id: string; ability_id: string; name: string | null; source_hash: string; source_text: string; leaves: CompileLeaf[] };

/** Current, fully described sources and their leaves, optionally for one faction. */
function tiledMembers(db: DatabaseSync, factionId: string | null): Member[] {
  const coverage = getCurrentCoverage(db);
  const abilities = db.prepare(`
    SELECT id, faction_id, ability_id, name, source_hash, source_text FROM abilities
    WHERE current = 1 AND (? IS NULL OR faction_id = ?) ORDER BY faction_id, ability_id
  `).all(factionId, factionId) as Array<Omit<Member, "leaves">>;
  const leaves = new Map<number, CompileLeaf[]>();
  for (const row of db.prepare(`
    SELECT source_spans.ability_version_id, source_spans.start_byte, semantic_families.role,
      fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active'
  `).all() as Array<{ ability_version_id: number; start_byte: number; role: string; family_id: string; family_version: number; parameters_json: string }>) {
    const list = leaves.get(row.ability_version_id) ?? [];
    list.push({ role: row.role, family_id: row.family_id, family_version: row.family_version, parameters: JSON.parse(row.parameters_json) as Record<string, unknown>, start_byte: row.start_byte });
    leaves.set(row.ability_version_id, list);
  }
  return abilities.flatMap((ability) => {
    const view = coverage.get(ability.id);
    const own = leaves.get(ability.id);
    if (!view || !own?.length || untiledRuns(view).length > 0) return [];
    return [{ ...ability, leaves: own }];
  });
}

type EntryState = { status: string; inputs_hash: string; mechanics_hash: string };

function entryStates(db: DatabaseSync): Map<number, EntryState[]> {
  const states = new Map<number, EntryState[]>();
  for (const row of db.prepare("SELECT ability_version_id, status, inputs_hash, mechanics_json FROM compiled_entries WHERE status IN ('approved', 'rejected')").all() as Array<{ ability_version_id: number; status: string; inputs_hash: string; mechanics_json: string }>) {
    const list = states.get(row.ability_version_id) ?? [];
    list.push({ status: row.status, inputs_hash: row.inputs_hash, mechanics_hash: hashJson(JSON.parse(row.mechanics_json)) });
    states.set(row.ability_version_id, list);
  }
  return states;
}

/** approved: this exact compilation is approved; stale: an approval exists for older leaves; rejected: a reviewer refused this compilation. */
function memberState(states: EntryState[] | undefined, inputsHash: string, compiled: Compiled): "approved" | "rejected" | "stale" | "open" {
  const mechanicsHash = compiled.ok ? hashJson(compiled.mechanics) : null;
  const current = (states ?? []).filter((state) => state.inputs_hash === inputsHash && state.mechanics_hash === mechanicsHash);
  if (current.some((state) => state.status === "approved")) return "approved";
  if (current.some((state) => state.status === "rejected")) return "rejected";
  return (states ?? []).some((state) => state.status === "approved") ? "stale" : "open";
}

export type ShapeSummary = { signature: string; members: number; distinct_sources: number; compiles: number; approved: number; open: number; first_error: string | null };

export function listShapes(db: DatabaseSync, options: { factionId?: string } = {}): { shapes: ShapeSummary[]; tiled: number } {
  const members = tiledMembers(db, options.factionId?.trim() || null);
  const states = entryStates(db);
  const shapes = new Map<string, ShapeSummary & { sources: Set<string> }>();
  for (const member of members) {
    const compiled = compileLeaves(member.leaves);
    const entry = shapes.get(compiled.signature) ?? { signature: compiled.signature, members: 0, distinct_sources: 0, compiles: 0, approved: 0, open: 0, first_error: null, sources: new Set<string>() };
    entry.members += 1;
    entry.sources.add(member.source_hash);
    if (compiled.ok) entry.compiles += 1;
    else entry.first_error ??= compiled.errors[0] ?? null;
    const state = memberState(states.get(member.id), compilationInputsHash(db, member.id), compiled);
    if (state === "approved") entry.approved += 1;
    if (compiled.ok && (state === "open" || state === "stale")) entry.open += 1;
    shapes.set(compiled.signature, entry);
  }
  return {
    tiled: members.length,
    shapes: [...shapes.values()].map(({ sources, ...shape }) => ({ ...shape, distinct_sources: sources.size }))
      .sort((left, right) => right.open - left.open || right.members - left.members || left.signature.localeCompare(right.signature)),
  };
}

export type ShapeMember = {
  ability_version_ids: number[];
  abilities: Array<{ ability_version_id: number; faction_id: string; ability_id: string; name: string | null }>;
  source_text: string;
  authored_text: string | null;
  compiled_text: string | null;
  differs: boolean;
  state: "approved" | "rejected" | "stale" | "open";
  errors: string[];
};

function render(factionId: string, abilityId: string, compiled: Compiled): { authored: string | null; compiled: string | null; errors: string[]; differs: boolean } {
  let original: Record<string, unknown>;
  try {
    original = resolveAbilityEntity(round5cDataRoot(), factionId, abilityId).entry;
  } catch (error) {
    return { authored: null, compiled: null, errors: [error instanceof Error ? error.message : String(error)], differs: true };
  }
  const authored = checkEntry(original).rendered_text;
  if (!compiled.ok) return { authored, compiled: null, errors: compiled.errors, differs: true };
  const entry = entryWithMechanics(original, compiled.mechanics);
  const check = checkEntry(entry);
  const fields = ["effect", "scope", "behavior", "trigger"] as const;
  const differs = fields.some((field) => hashJson(original[field] ?? null) !== hashJson(entry[field] ?? null));
  return { authored, compiled: check.rendered_text, errors: check.errors, differs };
}

/**
 * One shape's members, byte-identical sources folded together, with the authored render beside
 * the compiled one. Members whose compiled entry differs from what is authored come first.
 */
export function getShape(db: DatabaseSync, signature: string, options: { factionId?: string } = {}): { signature: string; members: ShapeMember[] } {
  const states = entryStates(db);
  const groups = new Map<string, ShapeMember>();
  for (const member of tiledMembers(db, options.factionId?.trim() || null)) {
    const compiled = compileLeaves(member.leaves);
    if (compiled.signature !== signature) continue;
    const state = memberState(states.get(member.id), compilationInputsHash(db, member.id), compiled);
    const shown = render(member.faction_id, member.ability_id, compiled);
    const key = `${member.source_hash}\u0000${shown.compiled}\u0000${shown.authored}\u0000${state}`;
    const group = groups.get(key) ?? {
      ability_version_ids: [], abilities: [], source_text: member.source_text, authored_text: shown.authored,
      compiled_text: shown.compiled, differs: shown.differs, state, errors: shown.errors,
    };
    group.ability_version_ids.push(member.id);
    group.abilities.push({ ability_version_id: member.id, faction_id: member.faction_id, ability_id: member.ability_id, name: member.name });
    groups.set(key, group);
  }
  if (groups.size === 0) throw new ShapeError(404, `No fully described source has the shape ${signature}.`);
  return {
    signature,
    members: [...groups.values()].sort((left, right) => Number(right.differs) - Number(left.differs) || right.ability_version_ids.length - left.ability_version_ids.length),
  };
}

function parse(value: unknown): { reviewer: string; signature: string; ids: number[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ShapeError(422, "Expected {reviewer, signature, ability_version_ids}.");
  const input = value as Record<string, unknown>;
  if (typeof input.reviewer !== "string" || !input.reviewer.trim()) throw new ShapeError(422, "reviewer is required.");
  if (typeof input.signature !== "string" || !input.signature.trim()) throw new ShapeError(422, "signature is required.");
  if (!Array.isArray(input.ability_version_ids) || input.ability_version_ids.length === 0 || !input.ability_version_ids.every((id) => Number.isSafeInteger(id))) {
    throw new ShapeError(422, "ability_version_ids must list at least one source version.");
  }
  return { reviewer: input.reviewer, signature: input.signature, ids: [...new Set(input.ability_version_ids as number[])] };
}

function decide(db: DatabaseSync, value: unknown, status: "approved" | "rejected"): { batch_id: string; recorded: number } {
  const input = parse(value);
  return withTransaction(db, () => {
    const members = new Map(tiledMembers(db, null).map((member) => [member.id, member]));
    const batchId = `batch_${randomUUID()}`;
    db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json) VALUES (?, 'review', ?, ?, ?)")
      .run(batchId, input.reviewer, new Date().toISOString(), JSON.stringify({ action: `shape-${status}`, signature: input.signature }));
    const member = db.prepare("INSERT INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)");
    let recorded = 0;
    for (const id of input.ids) {
      const source = members.get(id);
      if (!source) throw new ShapeError(409, `Source version ${id} is no longer current and fully described; reload the shape.`);
      const compiled = compileLeaves(source.leaves);
      if (compiled.signature !== input.signature) throw new ShapeError(409, `${source.faction_id}/${source.ability_id} no longer has this shape; reload it.`);
      if (!compiled.ok) throw new ShapeError(422, `${source.faction_id}/${source.ability_id} does not compile: ${compiled.errors.join("; ")}`);
      if (status === "approved") {
        const shown = render(source.faction_id, source.ability_id, compiled);
        if (shown.errors.length > 0) throw new ShapeError(422, `${source.faction_id}/${source.ability_id} cannot be approved: ${shown.errors.join("; ")}`);
      }
      const inputsHash = compilationInputsHash(db, id);
      const entryId = `compiled_${hashJson({ ability_version_id: id, inputs_hash: inputsHash, mechanics: compiled.mechanics, status })}`;
      if (db.prepare("SELECT 1 FROM compiled_entries WHERE id = ? AND status = ?").get(entryId, status)) continue;
      if (status === "approved") {
        for (const previous of db.prepare("SELECT id FROM compiled_entries WHERE ability_version_id = ? AND status = 'approved'").all(id) as Array<{ id: string }>) {
          db.prepare("UPDATE compiled_entries SET status = 'retracted' WHERE id = ?").run(previous.id);
          member.run(batchId, "compiled-entry-replaced", previous.id);
        }
      }
      db.prepare(`
        INSERT INTO compiled_entries (id, ability_version_id, shape_signature, mechanics_json, inputs_hash, status, batch_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, batch_id = excluded.batch_id
      `).run(entryId, id, compiled.signature, JSON.stringify(compiled.mechanics), inputsHash, status, batchId, new Date().toISOString());
      member.run(batchId, `compiled-entry-${status}`, entryId);
      recorded += 1;
    }
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, recorded };
  });
}

/** Approve the compiled entry of each listed member of one shape. */
export function approveShape(db: DatabaseSync, value: unknown): { batch_id: string; recorded: number } {
  return decide(db, value, "approved");
}

/** Refuse the compiled entry of each listed member until its leaves change. */
export function rejectShapeMembers(db: DatabaseSync, value: unknown): { batch_id: string; recorded: number } {
  return decide(db, value, "rejected");
}

/** Text-keyed batch members this module owns. */
export const COMPILED_MEMBER_KINDS = new Set(["compiled-entry-approved", "compiled-entry-rejected", "compiled-entry-replaced"]);

export function assertShapeUndo(db: DatabaseSync, members: ReadonlyArray<{ entity_kind: string; entity_id: string }>): void {
  for (const item of members) {
    if (item.entity_kind !== "compiled-entry-approved" && item.entity_kind !== "compiled-entry-rejected") continue;
    const row = db.prepare("SELECT status FROM compiled_entries WHERE id = ?").get(item.entity_id) as { status: string } | undefined;
    if (!row || row.status !== item.entity_kind.slice("compiled-entry-".length)) throw new ShapeError(409, "This batch cannot be undone because one of its compiled entries was later changed.");
  }
}

export function applyShapeUndo(db: DatabaseSync, reversalId: string, members: ReadonlyArray<{ entity_kind: string; entity_id: string }>): void {
  const add = db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)");
  for (const item of members) {
    if (item.entity_kind === "compiled-entry-approved" || item.entity_kind === "compiled-entry-rejected") {
      db.prepare("UPDATE compiled_entries SET status = 'retracted' WHERE id = ?").run(item.entity_id);
      add.run(reversalId, "compiled-entry-retracted", item.entity_id);
    }
  }
  for (const item of members) {
    if (item.entity_kind !== "compiled-entry-replaced") continue;
    db.prepare("UPDATE compiled_entries SET status = 'approved' WHERE id = ? AND status = 'retracted'").run(item.entity_id);
    add.run(reversalId, "compiled-entry-restored", item.entity_id);
  }
}

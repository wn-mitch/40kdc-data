import type Ajv from "ajv";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRepairedEntry, lintCanonical } from "../author-batch.js";
import { hashJson } from "../round4/hash.js";
import { createValidator, findSchemaFiles, SCHEMAS_ROOT } from "../schema-loader.js";
import { describeAbility } from "../translate/effect.js";

/**
 * Tracked ability entries under the configured data root: guarded file resolution, the schema
 * tree identity, and a validated, rendered preview of mechanics grafted onto an existing entry.
 */

const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const ABILITY_SCHEMA_ID = "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json";
const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export type ResolvedAbilityEntity = {
  file: string;
  entries: Array<Record<string, unknown>>;
  index: number;
  entry: Record<string, unknown>;
};

/** The top-level ability fields a composition replaces; `null` removes the optional ones. */
export type Mechanics = {
  effect: Record<string, unknown>;
  scope: Record<string, unknown>;
  behavior: string | null;
  trigger: unknown | null;
  usage: unknown | null;
  applies_to: unknown | null;
};

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

/** What one set of mechanics would become for an ability, without persisting anything. */
export type MechanicsRender = { entry: Record<string, unknown> | null; rendered_text: string | null; errors: string[] };

let previewValidator: Ajv | null = null;

/** Graft mechanics onto an existing entry exactly as publication does, keeping community notes. */
export function entryWithMechanics(original: Record<string, unknown>, mechanics: Mechanics): Record<string, unknown> {
  const entry = buildRepairedEntry(original, mechanics.effect, mechanics.scope, mechanics.behavior ?? undefined, {
    trigger: mechanics.trigger, usage: mechanics.usage, applies_to: mechanics.applies_to,
  });
  if (Object.hasOwn(original, "community_notes")) entry.community_notes = original.community_notes;
  else delete entry.community_notes;
  if (mechanics.behavior === null) delete entry.behavior;
  return entry;
}

/**
 * Validate and render a complete entry through the ability schema, the canonical-form lint, and
 * the describer. Failures come back as messages, never as writes.
 */
export function checkEntry(entry: Record<string, unknown>): { rendered_text: string | null; errors: string[] } {
  const errors: string[] = [];
  previewValidator ??= createValidator();
  const validate = previewValidator.getSchema(ABILITY_SCHEMA_ID);
  if (!validate) errors.push("The ability schema is not registered.");
  else if (!validate(entry)) errors.push(...(validate.errors ?? []).map((issue) => `${issue.instancePath || "/"} ${issue.message ?? "invalid"}`));
  const lint = lintCanonical(entry.effect);
  if (!lint.canonical) errors.push(...lint.issues);
  let rendered: string | null = null;
  try {
    rendered = describeAbility(entry as never);
  } catch (error) {
    errors.push(`Describer failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { rendered_text: rendered, errors };
}

/** Render mechanics for one tracked ability, resolving its current entry from the data root. */
export function renderMechanicsPreview(factionId: string, abilityId: string, mechanics: Mechanics): MechanicsRender {
  let resolved: ResolvedAbilityEntity;
  try {
    resolved = resolveAbilityEntity(round5cDataRoot(), factionId, abilityId);
  } catch (error) {
    return { entry: null, rendered_text: null, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const entry = entryWithMechanics(resolved.entry, mechanics);
  return { entry, ...checkEntry(entry) };
}

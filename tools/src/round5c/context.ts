import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type JsonObject = Record<string, unknown>;

export type AbilityOwnerContext = {
  unit_id: string;
  name: string | null;
  role: string | null;
};

export type AbilitySelectionBudgetContext = {
  unit_id: string;
  count: number;
  per_models: number;
};

export type AbilityWargearOptionContext = {
  id: string;
  model_constraint: JsonObject | null;
};

export type AbilityWargearContext = {
  id: string;
  name: string | null;
  options: AbilityWargearOptionContext[];
};

export type ExistingDslContext = {
  /** This is tracked community-authored DSL, not the workbench's live proposal. */
  provenance: "existing-community-authored-dsl";
  effect: JsonObject | null;
  scope: JsonObject | null;
  game_version: JsonObject | null;
};

export type AbilityContext = {
  owners: AbilityOwnerContext[];
  wargear: AbilityWargearContext | null;
  selection_budgets: AbilitySelectionBudgetContext[];
  existing_dsl: ExistingDslContext | null;
};

type CoreUnit = {
  id?: unknown;
  name?: unknown;
  role?: unknown;
  ability_ids?: unknown;
  wargear_budgets?: unknown;
};

type CoreWargear = {
  id?: unknown;
  name?: unknown;
};

type CoreWargearOption = {
  id?: unknown;
  replaces?: unknown;
  replacement?: unknown;
  replacement_choice?: unknown;
  model_constraint?: unknown;
};

type EnrichmentAbility = {
  ability_id?: unknown;
  unit_ids?: unknown;
  effect?: unknown;
  scope?: unknown;
  game_version?: unknown;
};

type CachedFaction = {
  signature: string;
  units: CoreUnit[];
  wargear: CoreWargear[];
  wargearOptions: CoreWargearOption[];
  enrichment: EnrichmentAbility[];
};

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed as T[] : [];
}

function fileSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

function referencesAbility(value: unknown, abilityId: string): boolean {
  if (typeof value === "string") return value === abilityId;
  if (Array.isArray(value)) return value.some((entry) => referencesAbility(entry, abilityId));
  return false;
}

/**
 * Lazily reads faction-scoped tracked core/enrichment facts. Cache entries are
 * invalidated when any of their four JSON files changes, so a page never
 * reparses the same faction once per ability.
 */
export function createAbilityContextResolver(rootDir = DEFAULT_ROOT): (factionId: string, abilityId: string) => AbilityContext {
  const root = resolve(rootDir);
  const cache = new Map<string, CachedFaction>();

  function factionFacts(factionId: string): CachedFaction | null {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(factionId)) return null;
    const core = join(root, "data", "core", factionId);
    const enrichment = join(root, "data", "enrichment", factionId, "abilities.json");
    const paths = [
      join(core, "units.json"),
      join(core, "wargear.json"),
      join(core, "wargear-options.json"),
      enrichment,
    ];
    const signature = paths.map(fileSignature).join("|");
    const cached = cache.get(factionId);
    if (cached?.signature === signature) return cached;

    const facts: CachedFaction = {
      signature,
      units: readArray<CoreUnit>(paths[0]),
      wargear: readArray<CoreWargear>(paths[1]),
      wargearOptions: readArray<CoreWargearOption>(paths[2]),
      enrichment: readArray<EnrichmentAbility>(paths[3]),
    };
    cache.set(factionId, facts);
    return facts;
  }

  return (factionId: string, abilityId: string): AbilityContext => {
    const facts = factionFacts(factionId);
    if (!facts || !abilityId) {
      return { owners: [], wargear: null, selection_budgets: [], existing_dsl: null };
    }

    const enrichment = facts.enrichment.find((entry) => entry.ability_id === abilityId) ?? null;
    const enrichmentUnitIds = new Set(enrichment ? stringArray(enrichment.unit_ids) : []);
    const linkedUnits = facts.units.filter((unit) => {
      const unitId = asString(unit.id);
      return unitId !== null && (enrichmentUnitIds.has(unitId) || stringArray(unit.ability_ids).includes(abilityId));
    });
    const owners = linkedUnits
      .map((unit) => ({ unit_id: asString(unit.id)!, name: asString(unit.name), role: asString(unit.role) }))
      .sort((first, second) => first.unit_id.localeCompare(second.unit_id));

    const selection_budgets: AbilitySelectionBudgetContext[] = [];
    for (const unit of linkedUnits) {
      const unitId = asString(unit.id)!;
      for (const budget of Array.isArray(unit.wargear_budgets) ? unit.wargear_budgets : []) {
        const record = asObject(budget);
        if (!record || !stringArray(record.items).includes(abilityId)) continue;
        const count = numberValue(record.count);
        const perModels = numberValue(record.per_models);
        if (count === null || perModels === null) continue;
        selection_budgets.push({ unit_id: unitId, count, per_models: perModels });
      }
    }
    selection_budgets.sort((first, second) =>
      first.unit_id.localeCompare(second.unit_id) || first.count - second.count || first.per_models - second.per_models,
    );

    const matchedWargear = facts.wargear.find((entry) => entry.id === abilityId);
    const wargear = matchedWargear
      ? {
          id: abilityId,
          name: asString(matchedWargear.name),
          options: facts.wargearOptions
            .filter((option) =>
              referencesAbility(option.replaces, abilityId) ||
              referencesAbility(option.replacement, abilityId) ||
              referencesAbility(option.replacement_choice, abilityId),
            )
            .flatMap((option) => {
              const id = asString(option.id);
              return id === null ? [] : [{ id, model_constraint: asObject(option.model_constraint) }];
            })
            .sort((first, second) => first.id.localeCompare(second.id)),
        }
      : null;

    return {
      owners,
      wargear,
      selection_budgets,
      existing_dsl: enrichment
        ? {
            provenance: "existing-community-authored-dsl",
            effect: asObject(enrichment.effect),
            scope: asObject(enrichment.scope),
            game_version: asObject(enrichment.game_version),
          }
        : null,
    };
  };
}

export const resolveAbilityContext = createAbilityContextResolver();

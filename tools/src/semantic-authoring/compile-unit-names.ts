import { readFileSync } from "node:fs";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { foldName } from "./compile-weapon-names.js";

type UnitIdentity = { id: string; name: string };
export type UnitNameContext = { faction_id: string; units?: readonly UnitIdentity[] };
const catalogs = new Map<string, readonly UnitIdentity[]>();

function unitsIn(context: UnitNameContext): readonly UnitIdentity[] {
  if (context.units) return context.units;
  const cached = catalogs.get(context.faction_id);
  if (cached) return cached;
  const units = JSON.parse(readFileSync(new URL(`../../../data/core/${context.faction_id}/units.json`, import.meta.url), "utf8")) as UnitIdentity[];
  catalogs.set(context.faction_id, units);
  return units;
}

/** Resolve reviewed names before recipient/trigger folds. No cross-faction or keyword fallback. */
export function resolveUnitNames(leaves: readonly CompileLeaf[], context?: UnitNameContext): CompileLeaf[] {
  return leaves.map((leaf) => {
    const names = leaf.parameters.unit_names;
    if (names === undefined) return leaf;
    if (!context) throw new CompileError("Named unit identities require the owning faction's unit catalog.");
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string")) {
      throw new CompileError("Named unit identities must list exact datasheet names.");
    }
    if (leaf.parameters.level === "model" || (leaf.parameters.selects !== undefined && leaf.parameters.selects !== "unit")) {
      throw new CompileError("Named unit identities cannot select model profiles.");
    }
    const units = unitsIn(context);
    const ids = (names as string[]).map((name) => {
      const folded = foldName(name.replaceAll("*", ""));
      const matches = units.filter((unit) => foldName(unit.name) === folded);
      if (matches.length !== 1) throw new CompileError(`Named unit ${JSON.stringify(name)} resolves to ${matches.length} datasheets in ${context.faction_id}; exactly one is required.`);
      return matches[0]!.id;
    });
    if (new Set(ids).size !== ids.length) throw new CompileError("Named units resolve to duplicate datasheet identities.");
    const { unit_names: _names, ...parameters } = leaf.parameters;
    return { ...leaf, parameters: { ...parameters, unit_ids: ids.sort() } };
  });
}

/** Conjoin exact identity restrictions rather than broadening an existing candidate set. */
export function narrowUnitIds(filter: Record<string, unknown>, ids: readonly string[]): Record<string, unknown> {
  if (filter.level === "model") throw new CompileError("A unit identity restriction cannot narrow a model-level filter.");
  const existing = filter.unit_ids as string[] | undefined;
  const narrowed = existing ? ids.filter((id) => existing.includes(id)) : [...ids];
  if (narrowed.length === 0) throw new CompileError("The trigger and target name disjoint unit identities.");
  return { ...filter, level: "unit", unit_ids: narrowed };
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether an id a leaf names (event@17 `id`, `by-ability`, `ability-used`) resolves to a rule the
 * record can mean: an ability record of the record's faction or a core ability, a core Stratagem,
 * or an action of one of the faction's resource-action menus. A subject of this unit or this model
 * also needs a datasheet that holds the record to hold that ability, which catches a wrong faction
 * variant of the same name.
 */

type Entry = Record<string, unknown>;

type FactionRules = { abilities: Map<string, Entry>; actions: Set<string>; units: Array<{ ability_ids: string[] }> };

const cache = new Map<string, Map<string, FactionRules>>();

function readArray(path: string): Entry[] {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Entry[] : [];
}

/** Every action id of a resource-action-menu anywhere inside a DSL tree. */
function menuActions(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) menuActions(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Entry;
  if (record.type === "resource-action-menu" && Array.isArray(record.actions)) {
    for (const action of record.actions as Entry[]) if (typeof action.id === "string") into.add(action.id);
  }
  for (const value of Object.values(record)) menuActions(value, into);
}

function factionRules(dataRoot: string): Map<string, FactionRules> {
  const cached = cache.get(dataRoot);
  if (cached) return cached;
  const result = new Map<string, FactionRules>();
  const enrichment = join(dataRoot, "enrichment");
  const factions = existsSync(enrichment) ? readdirSync(enrichment).filter((name) => !name.startsWith("_") && existsSync(join(enrichment, name, "abilities.json"))) : [];
  for (const faction of factions) {
    const entries = readArray(join(enrichment, faction, "abilities.json"));
    const actions = new Set<string>();
    for (const entry of entries) menuActions(entry.effect, actions);
    const units = readArray(join(dataRoot, "core", faction, "units.json")).map((unit) => ({ ability_ids: Array.isArray(unit.ability_ids) ? unit.ability_ids as string[] : [] }));
    result.set(faction, { abilities: new Map(entries.map((entry) => [String(entry.ability_id), entry])), actions, units });
  }
  cache.set(dataRoot, result);
  return result;
}

const coreIdCache = new Map<string, { abilities: Set<string>; stratagems: Set<string> }>();

function coreIds(dataRoot: string): { abilities: Set<string>; stratagems: Set<string> } {
  const cached = coreIdCache.get(dataRoot);
  if (cached) return cached;
  const ids = {
    abilities: new Set(readArray(join(dataRoot, "core", "unit-keywords.json")).map((entry) => String(entry.id))),
    stratagems: new Set<string>(),
  };
  const core = join(dataRoot, "core");
  if (existsSync(core)) {
    for (const faction of ["", ...readdirSync(core)]) {
      for (const record of readArray(join(core, faction, "stratagems.json"))) ids.stratagems.add(String(record.ability_id ?? record.id));
    }
  }
  coreIdCache.set(dataRoot, ids);
  return ids;
}

/** The disagreement for one named id, or null when it resolves. */
export function namedAbilityProblem(dataRoot: string, abilityId: string, parameters: Record<string, unknown>): string | null {
  const id = String(parameters.id);
  const activity = String(parameters.activity);
  const rules = factionRules(dataRoot);
  const own = [...rules.entries()].filter(([, faction]) => faction.abilities.has(abilityId));
  if (activity === "stratagem") return coreIds(dataRoot).stratagems.has(id) ? null : `${id} is not a core Stratagem.`;
  if (activity === "manoeuvre" || activity === "action") {
    return own.some(([, faction]) => faction.actions.has(id)) ? null : `${id} is no action of a resource-action menu of ${own.map(([name]) => name).join(", ") || "the record's faction"}.`;
  }
  const isCore = coreIds(dataRoot).abilities.has(id);
  const holders = own.filter(([, faction]) => faction.abilities.has(id));
  if (!isCore && holders.length === 0) return `${id} is no ability record of ${own.map(([name]) => name).join(", ") || "the record's faction"} and no core ability.`;
  if (parameters.subject !== "this-unit" && parameters.subject !== "this-model") return null;
  // A datasheet ability names the unit that holds it; an army or detachment rule is every unit's.
  if (isCore || holders.some(([, faction]) => ["faction", "detachment"].includes(String(faction.abilities.get(id)!.ability_type)))) return null;
  const datasheets = own.flatMap(([, faction]) => faction.units.filter((unit) => unit.ability_ids.includes(abilityId)));
  if (datasheets.length === 0 || datasheets.some((unit) => unit.ability_ids.includes(id))) return null;
  return `No datasheet that has ${abilityId} has ${id}.`;
}

/** Every action id of a faction's menus, and those whose own move rolls the die (a string distance such as "D6+1"). */
export type ManoeuvreMenus = { actions: string[]; withDie: string[] };

const DIE_DISTANCE = { D6: /^D6(\+\d+)?$/u };

function moveDistances(node: unknown, into: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) moveDistances(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Entry;
  if (record.type === "move" || record.type === "make-move") {
    const modifier = record.modifier as Entry | undefined;
    into.push(modifier?.distance ?? record.distance);
  }
  for (const value of Object.values(record)) moveDistances(value, into);
}

/**
 * The menus of the faction whose enrichment holds one ability id: every action, and the actions
 * whose own move gives the die as a distance. Null when no faction holds the id. Read from the
 * enrichment file directly so the distances are visible (the factionRules cache keeps ids only).
 */
export function menuActionsForAbility(dataRoot: string, abilityId: string, die: keyof typeof DIE_DISTANCE): ManoeuvreMenus | null {
  const enrichment = join(dataRoot, "enrichment");
  if (!existsSync(enrichment)) return null;
  const factions = readdirSync(enrichment).filter((name) => !name.startsWith("_") && existsSync(join(enrichment, name, "abilities.json")));
  const faction = factions.find((name) => readArray(join(enrichment, name, "abilities.json")).some((entry) => entry.ability_id === abilityId));
  if (faction === undefined) return null;
  const actions: string[] = [];
  const withDie: string[] = [];
  for (const entry of readArray(join(enrichment, faction, "abilities.json"))) {
    const found = new Set<string>();
    menuActions(entry.effect, found);
    for (const id of found) actions.push(id);
    for (const menu of collectMenus(entry.effect)) {
      for (const action of menu.actions as Entry[]) {
        const distances: unknown[] = [];
        moveDistances(action.effect, distances);
        if (distances.some((distance) => typeof distance === "string" && DIE_DISTANCE[die].test(distance))) withDie.push(String(action.id));
      }
    }
  }
  return { actions: [...new Set(actions)].sort(), withDie: [...new Set(withDie)].sort() };
}

function collectMenus(node: unknown, into: Entry[] = []): Entry[] {
  if (Array.isArray(node)) {
    for (const item of node) collectMenus(item, into);
    return into;
  }
  if (node === null || typeof node !== "object") return into;
  const record = node as Entry;
  if (record.type === "resource-action-menu" && Array.isArray(record.actions)) into.push(record);
  for (const value of Object.values(record)) collectMenus(value, into);
  return into;
}

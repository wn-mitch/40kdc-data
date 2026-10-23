import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { glob } from "glob";
import type { ValidationResult } from "./validate.js";

type Node = Record<string, unknown>;
type Issue = { path: string; message: string };
type RecordFile = { file: string; faction: string; rows: unknown[] };
type CatalogEntry = { required: Set<string>; allowed: Set<string> };
const node = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

function visit(value: unknown, path: string, callback: (value: Node, path: string) => void | boolean): void {
  if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}/${index}`, callback));
  else if (node(value)) {
    if (callback(value, path) === false) return;
    for (const [key, item] of Object.entries(value)) visit(item, `${path}/${key}`, callback);
  }
}

function rows(file: string): unknown[] {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(value) ? value : [];
}

function event(value: unknown): boolean {
  return node(value) ? typeof value.event === "string" : Array.isArray(value) && value.length > 0 && value.every(event);
}

/** Local activation excludes historical guards and granted holders' independent abilities. */
function hasActivation(ability: Node): boolean {
  if (event(ability.trigger)) return true;
  let found = false;
  visit(ability.effect, "", (value) => {
    if (value.type === "ability-grant") return false;
    if (value.type === "ability-part" && event(value.trigger)) found = true;
    if (value.type === "resource-action-menu" && Array.isArray(value.actions)) {
      if (value.actions.some((action) => node(action) && event(action.when))) found = true;
    }
  });
  return found;
}

function optionIds(ability: Node): string[] {
  const result: string[] = [];
  visit(ability.effect, "", (value) => {
    if ((value.type === "stance-select" || value.type === "dice-pool-allocation") && Array.isArray(value.options)) {
      for (const option of value.options) if (node(option) && typeof option.id === "string") result.push(option.id);
    }
  });
  return result;
}

function definitionIds(ability: Node): Set<string> {
  const ids = new Set<string>();
  visit(ability.effect, "", (value) => {
    if (value.type !== "ability-grant" || !node(value.modifier) || !node(value.modifier.definition)) return;
    const ref = value.modifier.ability;
    if (node(ref) && ref.ability_id === ability.ability_id && typeof ref.definition_id === "string") ids.add(ref.definition_id);
  });
  return ids;
}

/** Numeric and battle-size bounds can be compared without evaluating a roll or board state. */
function checkBounds(value: Node, path: string, issues: Issue[]): void {
  if (!("min" in value) || !("max" in value)) return;
  const { min, max } = value;
  if (typeof min === "number" && typeof max === "number" && min > max) {
    issues.push({ path, message: "inclusive count minimum exceeds maximum" });
  }
  for (const key of ["incursion", "strike-force", "onslaught"]) {
    const low = node(min) ? min[key] : min;
    const high = node(max) ? max[key] : max;
    if ((node(min) || node(max)) && typeof low === "number" && typeof high === "number" && low > high) {
      issues.push({ path: `${path}/${key}`, message: "count minimum exceeds maximum for this quantity case" });
    }
  }
}

function checkKeyword(ref: unknown, path: string, required: boolean, catalog: ReadonlyMap<string, CatalogEntry>, issues: Issue[]): void {
  if (!node(ref) || typeof ref.keyword_id !== "string") return; // malformed shapes belong to schema validation
  const entry = catalog.get(ref.keyword_id);
  if (!entry) {
    issues.push({ path: `${path}/keyword_id`, message: `unknown weapon keyword "${ref.keyword_id}"` });
    return;
  }
  const parameters = node(ref.parameters) ? ref.parameters : {};
  for (const key of Object.keys(parameters)) {
    if (key !== "required_target_keywords_any" && key !== "excluded_target_keywords" && !entry.allowed.has(key)) issues.push({ path: `${path}/parameters/${key}`, message: `weapon keyword "${ref.keyword_id}" does not accept parameter "${key}"` });
  }
  if (required) for (const key of entry.required) {
    // Anti may target an explicit keyword, a union, or the complement of listed keywords.
    if (ref.keyword_id === "anti" && key === "target_keyword"
      && (strings(parameters.required_target_keywords_any).length > 0 || strings(parameters.excluded_target_keywords).length > 0)) continue;
    if (!(key in parameters)) issues.push({ path: `${path}/parameters/${key}`, message: `weapon keyword "${ref.keyword_id}" requires parameter "${key}"` });
  }
}

/** Identity resolves faction-locally, then in shared core; labels never participate. */
export async function checkDslContract(root: string, result: ValidationResult): Promise<void> {
  const files: RecordFile[] = [];
  const abilities = new Map<string, Map<string, Node>>();
  for (const file of (await glob("enrichment/*/abilities.json", { cwd: root, absolute: true })).sort()) {
    const faction = basename(dirname(file));
    if (faction.startsWith("_") && faction !== "_core") continue;
    const values = rows(file);
    files.push({ file, faction, rows: values });
    const indexed = new Map<string, Node>();
    for (const value of values) if (node(value) && typeof value.ability_id === "string") indexed.set(value.ability_id, value);
    abilities.set(faction, indexed);
  }
  const parents = new Map<string, string | null>();
  const parentOf = (faction: string): string | null => {
    if (!parents.has(faction)) {
      let parent: string | null = null;
      try {
        const rows = JSON.parse(readFileSync(join(root, "core", faction, "factions.json"), "utf8")) as Array<{ id?: unknown; parent_faction_id?: unknown }>;
        const own = rows.find((row) => row.id === faction)?.parent_faction_id;
        parent = typeof own === "string" ? own : null;
      } catch {
        parent = null;
      }
      parents.set(faction, parent);
    }
    return parents.get(faction)!;
  };
  const catalog = new Map<string, CatalogEntry>();
  for (const file of await glob("core/weapon-keywords.json", { cwd: root, absolute: true })) {
    for (const entry of rows(file)) if (node(entry) && typeof entry.id === "string") {
      const required = new Set(strings(entry.required_parameters));
      catalog.set(entry.id, { required, allowed: new Set([...required, ...strings(entry.optional_parameters)]) });
    }
  }
  for (const { file, faction, rows: values } of files) values.forEach((ability, index) => {
    if (!node(ability)) return;
    const issues: Issue[] = [];
    const base = `/${index}`;
    // A shared-roster child (a Space Marine chapter) uses its parent's rules as well as its own.
    const parent = parentOf(faction);
    const resolveAbility = (id: string) => abilities.get(faction)?.get(id) ?? (parent ? abilities.get(parent)?.get(id) : undefined) ?? abilities.get("_core")?.get(id);
    const checkOption = (abilityId: string, optionId: string, path: string): void => {
      const parent = resolveAbility(abilityId);
      if (!parent) issues.push({ path, message: `stance parent "${abilityId}" is absent from this faction and shared core` });
      else if (!optionIds(parent).includes(optionId)) issues.push({ path, message: `option "${optionId}" is absent from ability "${abilityId}"` });
    };
    if (ability.behavior === "reactive" && !hasActivation(ability)) {
      issues.push({ path: `${base}/behavior`, message: "reactive ability requires a top-level or supported local activation trigger" });
    }
    const seen = new Set<string>();
    const definitions = new Set<string>();
    visit(ability, base, (value, path) => {
      checkBounds(value, path, issues);
      if (value.type === "rule-active" && node(value.parameters) && typeof value.parameters.rule === "string" && !resolveAbility(value.parameters.rule)) {
        issues.push({ path: `${path}/parameters/rule`, message: `rule "${value.parameters.rule}" is absent from this faction and shared core` });
      }
      if (typeof value.ability_id === "string" && typeof value.option_id === "string") checkOption(value.ability_id, value.option_id, path);
      if (typeof value.ability_id === "string" && typeof value.definition_id === "string") {
        const parent = resolveAbility(value.ability_id);
        if (!parent) issues.push({ path, message: `definition parent "${value.ability_id}" is absent from this faction and shared core` });
        else if (!definitionIds(parent).has(value.definition_id)) issues.push({ path, message: `definition "${value.definition_id}" is absent from ability "${value.ability_id}"` });
      }
      if (value.type === "ability-grant" && node(value.modifier) && node(value.modifier.definition) && node(value.modifier.ability)) {
        const ref = value.modifier.ability;
        if (typeof ref.definition_id === "string") {
          if (ref.ability_id !== ability.ability_id) issues.push({ path: `${path}/modifier/ability`, message: "named definition must be declared in its owning ability" });
          if (definitions.has(ref.definition_id)) issues.push({ path: `${path}/modifier/ability/definition_id`, message: `duplicate named definition "${ref.definition_id}" within this ability` });
          definitions.add(ref.definition_id);
        }
      }
      if ((value.type === "stance-select" || value.type === "dice-pool-allocation") && Array.isArray(value.options)) value.options.forEach((option, at) => {
        if (!node(option) || typeof option.id !== "string") return;
        if (seen.has(option.id)) issues.push({ path: `${path}/options/${at}/id`, message: `duplicate stance option id "${option.id}" within this ability` });
        seen.add(option.id);
      });
      if (value.type === "ability-activate" && node(value.modifier)) {
        const modifier = value.modifier;
        if (typeof modifier.ability === "string") {
          const parent = resolveAbility(modifier.ability);
          if (!parent) issues.push({ path: `${path}/modifier/ability`, message: `ability "${modifier.ability}" is absent from this faction and shared core` });
          for (const id of [...(typeof modifier.option === "string" ? [modifier.option] : []), ...strings(modifier.options), ...(node(modifier.select) ? strings(modifier.select.from) : [])]) checkOption(modifier.ability, id, `${path}/modifier`);
        }
      }
      if (value.type === "stance-selection-capacity" && node(value.modifier)) {
        const modifier = value.modifier;
        if (typeof modifier.ability_id === "string") {
          const parent = resolveAbility(modifier.ability_id);
          if (!parent || optionIds(parent).length === 0) issues.push({ path: `${path}/modifier/ability_id`, message: `stance "${modifier.ability_id}" has no options in this faction or shared core` });
          const references = [...(node(modifier.option) ? [modifier.option] : []), ...(Array.isArray(modifier.options) ? modifier.options : [])];
          for (const ref of references) if (node(ref) && ref.ability_id !== modifier.ability_id) issues.push({ path: `${path}/modifier`, message: "capacity options must belong to the containing ability_id" });
        }
        if (modifier.allocation === "fixed-option" && (!node(modifier.option) || modifier.options !== undefined)
          || modifier.allocation === "choose-one-option" && modifier.option !== undefined) issues.push({ path: `${path}/modifier`, message: "stance capacity allocation fields are incompatible" });
      }
      if (typeof value.keyword_id === "string") checkKeyword(value, path, false, catalog, issues);
      if (value.type === "weapon-ability-grant" && node(value.modifier) && Array.isArray(value.modifier.keywords)) {
        value.modifier.keywords.forEach((keyword, at) => checkKeyword(keyword, `${path}/modifier/keywords/${at}`, true, catalog, issues));
      }
    });
    if (issues.length) { result.failed++; result.errors.push({ file, index, errors: issues }); }
  });
  // Core profile grants share the catalog contract with DSL grants.
  for (const file of await glob("core/*/weapons.json", { cwd: root, absolute: true })) rows(file).forEach((weapon, index) => {
    const issues: Issue[] = [];
    visit(weapon, `/${index}`, (value, path) => {
      if (typeof value.keyword_id === "string") checkKeyword(value, path, true, catalog, issues);
    });
    if (issues.length) { result.failed++; result.errors.push({ file: resolve(file), index, errors: issues }); }
  });
}

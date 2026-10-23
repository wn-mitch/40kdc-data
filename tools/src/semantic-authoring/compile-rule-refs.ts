import { existsSync, readFileSync } from "node:fs";
import type { CompileLeaf } from "./compile-fragments.js";
import type { UnitNameContext } from "./compile-unit-names.js";

/**
 * A leaf names a rule or ability as it is printed ("Reanimation Protocols", "Devastator Doctrine");
 * the record that prints it carries its faction's id ("reanimation-protocols-necrons") or is one
 * option of a stance ("combat-doctrines-adeptus-astartes" / "devastator-doctrine"). Each reference
 * resolves within the record's own faction, then the faction it inherits rules from, then shared
 * core, and only to a single candidate; anything else is left as written for integrity to report.
 * A granted weapon's printed name resolves the same way to its weapons.json id.
 */

type Catalog = {
  ids: Set<string>;
  /** Record ids by printed-name slug. */
  byName: Map<string, string[]>;
  /** Stance options by option id and by option-name slug. */
  options: Map<string, Array<{ ability_id: string; option_id: string; scoped: boolean }>>;
  /** Abilities a record prints inside itself ("Fortify Takeover" in Prioritised Efficiency), by id and name slug. */
  definitions: Map<string, Array<{ ability_id: string; definition_id: string }>>;
};

const DATA = new URL("../../../data/", import.meta.url);
const catalogs = new Map<string, Catalog>();
const parents = new Map<string, string | null>();

const slug = (name: string): string => name.toLowerCase().replace(/[’']/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

function readJson(path: URL): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

/** The faction a shared-roster child inherits rules from (a Space Marine chapter's adeptus-astartes). */
export function parentFaction(factionId: string): string | null {
  if (!parents.has(factionId)) {
    const rows = readJson(new URL(`core/${factionId}/factions.json`, DATA)) as Array<{ id?: string; parent_faction_id?: string | null }>;
    parents.set(factionId, rows.find((row) => row.id === factionId)?.parent_faction_id ?? null);
  }
  return parents.get(factionId)!;
}

function catalogOf(factionId: string): Catalog {
  const cached = catalogs.get(factionId);
  if (cached) return cached;
  const catalog: Catalog = { ids: new Set(), byName: new Map(), options: new Map(), definitions: new Map() };
  const push = <T>(map: Map<string, T[]>, key: string, value: T): void => { map.set(key, [...(map.get(key) ?? []), value]); };
  for (const record of readJson(new URL(`enrichment/${factionId}/abilities.json`, DATA)) as Array<Record<string, unknown>>) {
    const id = record.ability_id;
    if (typeof id !== "string") continue;
    catalog.ids.add(id);
    if (typeof record.name === "string") push(catalog.byName, slug(record.name), id);
    const effect = record.effect as Record<string, unknown> | undefined;
    if (effect?.type === "stance-select" && Array.isArray(effect.options)) {
      for (const option of effect.options as Array<Record<string, unknown>>) {
        if (typeof option.id !== "string") continue;
        // A detachment's own copy of a rule (a Combat Patrol's Combat Doctrines) is scoped to it.
        const ref = { ability_id: id, option_id: option.id, scoped: typeof record.detachment_id === "string" };
        push(catalog.options, option.id, ref);
        if (typeof option.name === "string" && slug(option.name) !== option.id) push(catalog.options, slug(option.name), ref);
      }
    }
    for (const [definitionId, name] of definitionsOf(record)) {
      const ref = { ability_id: id, definition_id: definitionId };
      push(catalog.definitions, definitionId, ref);
      if (name && slug(name) !== definitionId) push(catalog.definitions, slug(name), ref);
    }
  }
  catalogs.set(factionId, catalog);
  return catalog;
}

/** The named abilities a record defines in its own effect, as [definition id, printed name]. */
function definitionsOf(record: Record<string, unknown>): Array<[string, string | null]> {
  const found: Array<[string, string | null]> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const modifier = node.modifier as Record<string, unknown> | undefined;
    const ref = modifier?.ability as Record<string, unknown> | undefined;
    const definition = modifier?.definition as Record<string, unknown> | undefined;
    if (node.type === "ability-grant" && definition && ref && ref.ability_id === record.ability_id && typeof ref.definition_id === "string") {
      found.push([ref.definition_id, typeof definition.name === "string" ? definition.name : null]);
    }
    Object.values(node).forEach(visit);
  };
  visit(record.effect);
  return found;
}

/** Factions a reference resolves in, nearest first. */
function scopes(factionId: string): string[] {
  const parent = parentFaction(factionId);
  return [factionId, ...(parent ? [parent] : []), "_core"];
}

/** The record id a printed rule or ability name stands for, or null when none or several do. */
export function resolveRecordName(factionId: string, name: string): string | null {
  for (const faction of scopes(factionId)) {
    const catalog = catalogOf(faction);
    if (catalog.ids.has(name)) return name;
    if (catalog.ids.has(`${name}-${faction}`)) return `${name}-${faction}`;
    // A reference may drop the record name's leading article ("Shadow of Chaos" for "The Shadow of Chaos").
    const named = [...new Set([...(catalog.byName.get(name) ?? []), ...(catalog.byName.get(`the-${name}`) ?? [])])];
    if (named.length === 1) return named[0]!;
    if (named.length > 1) return null;
  }
  return null;
}

/** The stance option a printed option name stands for, or null when none or several do. */
export function resolveOptionName(factionId: string, name: string): { ability_id: string; option_id: string } | null {
  for (const faction of scopes(factionId)) {
    const found = catalogOf(faction).options.get(name) ?? [];
    const distinct = [...new Map(found.map((ref) => [`${ref.ability_id}#${ref.option_id}`, ref])).values()];
    // The army-wide rule wins over a detachment's own copy of it, as codex wins over Combat Patrol.
    const armyWide = distinct.length > 1 ? distinct.filter((ref) => !ref.scoped) : distinct;
    if (armyWide.length === 1) return { ability_id: armyWide[0]!.ability_id, option_id: armyWide[0]!.option_id };
    if (distinct.length > 0) return null;
  }
  return null;
}

/** The ability a record defines inside itself that a printed name stands for, or null when none or several do. */
export function resolveDefinitionName(factionId: string, name: string): { ability_id: string; definition_id: string } | null {
  for (const faction of scopes(factionId)) {
    const found = catalogOf(faction).definitions.get(name) ?? [];
    const distinct = [...new Map(found.map((ref) => [`${ref.ability_id}#${ref.definition_id}`, ref])).values()];
    if (distinct.length === 1) return distinct[0]!;
    if (distinct.length > 1) return null;
  }
  return null;
}

/** A named rule's record, else one option of a stance, else an ability a record defines inside itself. */
function resolveRule(faction: string, name: string): string | { ability_id: string; option_id: string } | { ability_id: string; definition_id: string } | null {
  return resolveRecordName(faction, name) ?? resolveOptionName(faction, name) ?? resolveDefinitionName(faction, name);
}

const weaponCatalogs = new Map<string, { ids: Set<string>; byName: Map<string, string[]> }>();

/** The weapon id a printed weapon name stands for, in the faction then its parent, or null when none or several do. */
export function resolveWeaponName(factionId: string, name: string): string | null {
  for (const faction of [factionId, ...(parentFaction(factionId) ? [parentFaction(factionId)!] : [])]) {
    let catalog = weaponCatalogs.get(faction);
    if (!catalog) {
      catalog = { ids: new Set(), byName: new Map() };
      for (const weapon of readJson(new URL(`core/${faction}/weapons.json`, DATA)) as Array<{ id?: unknown; name?: unknown }>) {
        if (typeof weapon.id !== "string") continue;
        catalog.ids.add(weapon.id);
        if (typeof weapon.name === "string") catalog.byName.set(slug(weapon.name), [...(catalog.byName.get(slug(weapon.name)) ?? []), weapon.id]);
      }
      weaponCatalogs.set(faction, catalog);
    }
    if (catalog.ids.has(name)) return name;
    const named = catalog.byName.get(name) ?? [];
    if (named.length === 1) return named[0]!;
    if (named.length > 1) return null;
  }
  return null;
}

const RECORD_KINDS = new Set(["ability", "faction-rule"]);

/** Resolve printed rule and ability names on the leaves that reference records. */
export function resolveRuleReferences(leaves: readonly CompileLeaf[], context?: UnitNameContext): CompileLeaf[] {
  if (!context) return [...leaves];
  const faction = context.faction_id;
  return leaves.map((leaf) => {
    const parameters = leaf.parameters;
    const withParameter = (key: string, value: unknown): CompileLeaf => ({ ...leaf, parameters: { ...parameters, [key]: value } });
    switch (leaf.family_id) {
      case "ability-record-grant":
      case "ability-activate":
      case "unit-has-ability": {
        const name = parameters.ability;
        if (typeof name !== "string") return leaf;
        const id = resolveRecordName(faction, name);
        return id && id !== name ? withParameter("ability", id) : leaf;
      }
      case "rule-state": {
        const name = parameters.rule;
        if (typeof name !== "string" || !RECORD_KINDS.has(String(parameters.rule_kind))) return leaf;
        const rule = resolveRule(faction, name);
        return rule && rule !== name ? withParameter("rule", rule) : leaf;
      }
      case "rule-active": {
        const name = parameters.rule;
        if (typeof name !== "string") return leaf;
        const rule = resolveRule(faction, name);
        return rule && rule !== name ? withParameter("rule", rule) : leaf;
      }
      case "weapon-grant": {
        const name = parameters.weapon_id;
        if (typeof name !== "string") return leaf;
        const id = resolveWeaponName(faction, name);
        return id && id !== name ? withParameter("weapon_id", id) : leaf;
      }
      default:
        return leaf;
    }
  });
}

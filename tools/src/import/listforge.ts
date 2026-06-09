/**
 * ListForge adapter: lower a decoded ListForge "share JSON" payload (a
 * BattleScribe-derived roster tree) to a {@link ParsedRoster}.
 *
 * The walk reads an ALLOWLIST of fields only — `name`, `number`, `type`,
 * `categories[].name`, `group`, and `costs` point values — and never touches
 * `rules[].description` or ability `profiles[].characteristics[].$text`, which
 * carry reproduced rules text. This keeps the importer's output free of
 * copyrighted prose by construction.
 *
 * Selection-tree shape (recursive `selections`):
 * - Configuration nodes (`type: "upgrade"`) named "Detachment" / "Battle Size"
 *   carry the chosen value as their first child selection.
 * - Unit nodes (`type: "model" | "unit"`) carry role categories, a points cost,
 *   and — nested anywhere beneath them — their wargear (weapon-category
 *   selections), enhancement (a selection whose `group` starts "Enhancements"),
 *   the "Warlord" marker, and model sub-selections.
 * - Every unit carries a `"Faction: <Name>"` category.
 *
 * @packageDocumentation
 */
import type { FormatAdapter } from "./adapter.js";
import type { ParsedRoster, ParsedUnit, ParsedWargear } from "./types.js";

const PTS_COST_NAME = "pts";
const FACTION_CATEGORY = /^Faction:\s*(.+)$/;
const POINTS_LIMIT = /(\d[\d,]*)\s*Point/i;
const ENHANCEMENT_GROUP_PREFIX = "Enhancements";
const CHARACTER_CATEGORIES = new Set(["Character", "Epic Hero"]);
const WEAPON_CATEGORY_SUFFIX = " Weapon"; // "Ranged Weapon", "Melee Weapon", "Psychic Weapon"
const NEWRECRUIT_XMLNS = "http://www.battlescribe.net/schema/rosterSchema";
const NEWRECRUIT_HOST_PREFIX = "https://newrecruit";

// --- Minimal structural views of the parts of the payload we read. ----------

interface RawCategory {
  name?: unknown;
}
interface RawCost {
  name?: unknown;
  value?: unknown;
}
interface RawSelection {
  name?: unknown;
  type?: unknown;
  number?: unknown;
  group?: unknown;
  categories?: unknown;
  costs?: unknown;
  selections?: unknown;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function selectionName(sel: RawSelection): string {
  return asString(sel.name) ?? "";
}

function selectionType(sel: RawSelection): string {
  return asString(sel.type) ?? "";
}

/** A selection's multiplicity (`number`), defaulting to 1. */
function selectionCount(sel: RawSelection): number {
  return typeof sel.number === "number" && sel.number > 0 ? sel.number : 1;
}

/** Point value from a selection's cost block, or null when absent. */
function pointsOf(sel: RawSelection): number | null {
  for (const raw of asArray(sel.costs)) {
    const cost = raw as RawCost;
    if (asString(cost.name) === PTS_COST_NAME && typeof cost.value === "number") {
      return cost.value;
    }
  }
  return null;
}

function categoryNames(sel: RawSelection): string[] {
  return asArray(sel.categories)
    .map((c) => asString((c as RawCategory).name))
    .filter((n): n is string => n !== null);
}

function childSelections(sel: RawSelection): RawSelection[] {
  return asArray(sel.selections) as RawSelection[];
}

/** Depth-first visit of a selection and everything beneath it. */
function walk(sel: RawSelection, visit: (s: RawSelection) => void): void {
  visit(sel);
  for (const child of childSelections(sel)) walk(child, visit);
}

function isUnitSelection(sel: RawSelection): boolean {
  const type = selectionType(sel);
  return type === "model" || type === "unit";
}

function isCharacter(sel: RawSelection): boolean {
  return categoryNames(sel).some((n) => CHARACTER_CATEGORIES.has(n));
}

function isWeaponSelection(sel: RawSelection): boolean {
  return categoryNames(sel).some((n) => n.endsWith(WEAPON_CATEGORY_SUFFIX));
}

function isEnhancementSelection(sel: RawSelection): boolean {
  const group = asString(sel.group);
  return group !== null && group.startsWith(ENHANCEMENT_GROUP_PREFIX);
}

/** Sum the model count of a unit from its nested model selections. */
function modelCount(unit: RawSelection): number {
  let total = 0;
  walk(unit, (s) => {
    if (selectionType(s) === "model") total += selectionCount(s);
  });
  return total > 0 ? total : selectionCount(unit);
}

/** Build a parsed unit from a top-level unit selection. */
function parseUnit(unit: RawSelection): ParsedUnit {
  const wargear: ParsedWargear[] = [];
  let enhancement_raw_name: string | null = null;
  let enhancement_points: number | null = null;
  let is_warlord = false;

  for (const node of childSelections(unit)) {
    walk(node, (s) => {
      if (isEnhancementSelection(s)) {
        if (enhancement_raw_name === null) {
          enhancement_raw_name = selectionName(s);
          enhancement_points = pointsOf(s);
        }
        return;
      }
      if (selectionName(s) === "Warlord") {
        is_warlord = true;
        return;
      }
      if (isWeaponSelection(s)) {
        wargear.push({ raw_name: selectionName(s), count: selectionCount(s) });
      }
    });
  }

  return {
    raw_name: selectionName(unit),
    is_character: isCharacter(unit),
    model_count: modelCount(unit),
    points: pointsOf(unit),
    is_warlord,
    enhancement_raw_name,
    enhancement_points,
    wargear,
  };
}

/** Value carried as the first child of a named configuration selection. */
function configValue(
  selections: RawSelection[],
  configName: string,
): string | null {
  const node = selections.find((s) => selectionName(s) === configName);
  if (!node) return null;
  const child = childSelections(node)[0];
  return child ? selectionName(child) : null;
}

/** Every value under a named config, across repeated blocks and multiple
 * children, in source order. Used for multi-detachment 11e lists. */
function configValues(selections: RawSelection[], configName: string): string[] {
  const out: string[] = [];
  for (const node of selections) {
    if (selectionName(node) !== configName) continue;
    for (const child of childSelections(node)) {
      const name = selectionName(child);
      if (name) out.push(name);
    }
  }
  return out;
}

function parseLimit(label: string | null): number | null {
  if (!label) return null;
  const match = POINTS_LIMIT.exec(label);
  if (!match) return null;
  return Number.parseInt(match[1].replace(/,/g, ""), 10);
}

/** First `"Faction: X"` category found anywhere; reports all distinct names. */
function collectFactions(forces: RawSelection[]): string[] {
  const seen = new Set<string>();
  for (const force of forces) {
    for (const sel of childSelections(force)) {
      walk(sel, (s) => {
        for (const name of categoryNames(s)) {
          const match = FACTION_CATEGORY.exec(name);
          if (match) seen.add(match[1].trim());
        }
      });
    }
  }
  return [...seen];
}

interface RawRoster {
  name?: unknown;
  costs?: unknown;
  forces?: unknown;
  xmlns?: unknown;
  generatedBy?: unknown;
}
interface RawPayload {
  name?: unknown;
  generatedBy?: unknown;
  roster?: unknown;
}

function rosterOf(decoded: unknown): RawRoster | null {
  if (!decoded || typeof decoded !== "object") return null;
  const roster = (decoded as RawPayload).roster;
  if (!roster || typeof roster !== "object") return null;
  if (!Array.isArray((roster as RawRoster).forces)) return null;
  return roster as RawRoster;
}

/** Detect a NewRecruit-flavoured BattleScribe payload. ListForge's matcher
 * excludes these so the greedy first-match dispatcher routes them to the
 * NewRecruit adapter without falling through to here. */
function hasNewRecruitSignature(decoded: unknown, roster: RawRoster): boolean {
  if (asString(roster.xmlns) === NEWRECRUIT_XMLNS) return true;
  const genBy =
    asString((decoded as RawPayload).generatedBy) ?? asString(roster.generatedBy);
  return genBy !== null && genBy.toLowerCase().startsWith(NEWRECRUIT_HOST_PREFIX);
}

export const listForgeAdapter: FormatAdapter = {
  id: "listforge",

  matches(decoded: unknown): boolean {
    const roster = rosterOf(decoded);
    if (!roster) return false;
    return !hasNewRecruitSignature(decoded, roster);
  },

  parse(decoded: unknown): ParsedRoster {
    const payload = decoded as RawPayload;
    const roster = rosterOf(decoded);
    if (!roster) {
      throw new Error("listforge: payload has no roster.forces array");
    }

    const forces = asArray(roster.forces) as RawSelection[];

    // Configuration lives among each force's top-level selections.
    const detachment_raw_names: string[] = [];
    let battle_size_raw: string | null = null;
    const units: ParsedUnit[] = [];
    for (const force of forces) {
      const top = childSelections(force);
      detachment_raw_names.push(...configValues(top, "Detachment"));
      battle_size_raw ??= configValue(top, "Battle Size");
      for (const sel of top) {
        if (isUnitSelection(sel)) units.push(parseUnit(sel));
      }
    }

    const factions = collectFactions(forces);
    const total_reported = pointsOf(roster as RawSelection);

    // Honest computed total: sum every cost line in the tree. A unit's own cost
    // and its nested enhancement's cost are distinct lines that together make up
    // the unit's army contribution, so a full walk reproduces the army total.
    let total_computed = 0;
    for (const force of forces) {
      for (const sel of childSelections(force)) {
        walk(sel, (s) => {
          const pts = pointsOf(s);
          if (pts) total_computed += pts;
        });
      }
    }

    return {
      name: asString(payload.name) ?? asString(roster.name) ?? "Imported roster",
      generated_by: asString(payload.generatedBy),
      faction_raw_name: factions[0] ?? null,
      detachment_raw_names,
      battle_size_raw,
      declared_limit: parseLimit(battle_size_raw),
      total_reported,
      total_computed,
      units,
      multi_force: factions.length > 1,
    };
  },
};

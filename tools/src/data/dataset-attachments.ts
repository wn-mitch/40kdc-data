/**
 * The ally and leader-attachment queries {@link Dataset} answers: the allied
 * rules an army qualifies for, the unit pool a rule grants, and the attachment
 * graph between leaders and bodyguards. Unit listings follow the dataset's game
 * mode.
 *
 * @packageDocumentation
 */
import type { AlliedRule, LeaderAttachment, Unit } from "../generated.js";
import { inGameMode } from "./collection.js";
import type { Dataset } from "./dataset.js";
import type { UnitView } from "./entities.js";

/** Whether `ds`'s game mode lists a unit. */
function listsMode(ds: Dataset, unit: Unit): boolean {
  return inGameMode(unit.game_modes, ds.gameMode);
}

/**
 * The allied-rules **offered** for an army of `factionId` running the given
 * detachments. A rule applies when both its gates pass: the **army gate**
 * (`army_keywords_any` empty, or intersecting the faction's keywords) and the
 * **detachment gate** (`detachment_ids` empty, or any listed id among `detachmentIds`). Order
 * follows the allied-rules data file. The strict "every *model* carries an
 * army keyword" check (for soup lists) is a builder/validation concern — this
 * offers the candidate rules a faction qualifies for. Mirror of Rust
 * `Dataset::allies_for`; pinned by the `allies_for` conformance query.
 */
export function alliesFor(
  ds: Dataset,
  factionId: string, detachmentIds: string[] = []): AlliedRule[] {
  const faction = ds.factions.get(factionId);
  if (!faction) return [];
  const factionKeywords = new Set(
    (faction.raw.keywords ?? []).map((k) => k.toLowerCase()),
  );
  const detachmentSet = new Set(detachmentIds);
  return ds.alliedRules.all.filter((rule) => {
    const armyGate =
      (rule.army_keywords_any ?? []).length === 0 ||
      (rule.army_keywords_any ?? []).some((k) =>
        factionKeywords.has(k.toLowerCase()),
      );
    const detachmentGate =
      (rule.detachment_ids ?? []).length === 0 ||
      (rule.detachment_ids ?? []).some((id) => detachmentSet.has(id));
    return armyGate && detachmentGate;
  });
}

/**
 * The unit pool an allied-rule grants, sorted by name. Starts from the rule's
 * `source_faction_id` (if set, to keep that faction's copy of shared ids) or
 * the whole dataset, then ANDs every filter the rule sets: `source_datasheet_ids`
 * (an explicit id allowlist — the primary selector for generated pools), any
 * `source_keywords`, `required_keywords` (all present), `excluded_keywords`
 * (none present), and `roles`. Empty for an unknown rule id or a pool that
 * resolves to nothing. Mirror of Rust `Dataset::ally_units_for`; pinned by the
 * `ally_units_for` conformance query.
 */
export function allyUnitsFor(
  ds: Dataset,
  ruleId: string): UnitView[] {
  const rule = ds.alliedRules.get(ruleId);
  if (!rule) return [];
  const base = rule.source_faction_id
    ? ds.units.byFaction(rule.source_faction_id)
    : ds.units.all;
  const sourceKeywords = (rule.source_keywords ?? []).map((k) =>
    k.toLowerCase(),
  );
  const required = (rule.required_keywords ?? []).map((k) => k.toLowerCase());
  const excluded = (rule.excluded_keywords ?? []).map((k) => k.toLowerCase());
  const roles = new Set(rule.roles ?? []);
  const datasheetIds = new Set(rule.source_datasheet_ids ?? []);
  const out = base.filter((u) => {
    const have = unitKeywordSet(u.raw);
    if (datasheetIds.size > 0 && !datasheetIds.has(u.raw.id)) return false;
    if (sourceKeywords.length > 0 && !sourceKeywords.some((k) => have.has(k)))
      return false;
    if (required.length > 0 && !required.every((k) => have.has(k)))
      return false;
    if (excluded.some((k) => have.has(k))) return false;
    if (roles.size > 0 && !(u.raw.role && roles.has(u.raw.role)))
      return false;
    return true;
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Leaders whose leader-attachment data lists `bodyguardUnitId` among its
 * eligible body units, sorted by name. The attachment is stored on the
 * leader pointing down to its bodyguards, so answering "which leaders can
 * attach to this unit?" means scanning the attachment list. A shared leader
 * chassis carries one attachment record per faction, so leaders are deduped
 * by id. Returns an empty array for a unit that no leader can attach to
 * (including leader units).
 */
export function leadersAttachableTo(
  ds: Dataset,
  bodyguardUnitId: string): UnitView[] {
  const bodyguard = ds.units.getAny(bodyguardUnitId);
  const seen = new Set<string>();
  return (
    ds.leaderAttachments
      .filter(
        (la) =>
          la.eligible_bodyguard_ids.includes(bodyguardUnitId) ||
          // Keyword eligibility (e.g. an Inquisitor leading any Imperium
          // Battleline Infantry unit): match on the bodyguard's keyword set.
          (bodyguard !== undefined &&
            matchesBodyguardKeywords(la, bodyguard.raw)),
      )
      // Attachment data is faction-agnostic (no faction context here); accept
      // first-wins for a shared leader/bodyguard chassis via getAny.
      .map((la) => ds.units.getAny(la.leader_id))
      .filter((u): u is UnitView => {
        if (u === undefined || seen.has(u.id)) return false;
        if (!listsMode(ds, u.raw)) return false;
        seen.add(u.id);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

/**
 * The inverse of {@link leadersAttachableTo}: the body units the given
 * leader can attach to, sorted by name. Scans the same leader-attachment
 * data from the leader's side (`leader_id` matches; resolve each
 * `eligible_bodyguard_ids` entry), deduped by id. Empty for a non-leader
 * unit. Together the two queries give the bidirectional attachment graph the
 * SPA needs to offer a partner dropdown from either end.
 */
export function bodyguardsAttachableFrom(
  ds: Dataset,
  
  leaderUnitId: string,
  factionId?: string,
): UnitView[] {
  const seen = new Set<string>();
  const out: UnitView[] = [];
  const add = (unit: UnitView | undefined) => {
    if (!unit || seen.has(unit.id) || !listsMode(ds, unit.raw)) return;
    seen.add(unit.id);
    out.push(unit);
  };
  for (const la of ds.leaderAttachments) {
    if (la.leader_id !== leaderUnitId) continue;
    const bodyguards = la.eligible_bodyguard_ids.map((id) =>
      factionId
        ? ds.units.getInFaction(id, factionId)
        : ds.units.getAny(id),
    );
    if (
      factionId &&
      bodyguards.every((unit) => unit === undefined) &&
      !la.eligible_bodyguard_keywords?.length
    )
      continue;
    for (const bodyguard of bodyguards) add(bodyguard);
    if (la.eligible_bodyguard_keywords?.length) {
      for (const view of ds.units.all) {
        if (
          (!factionId || view.raw.faction_id === factionId) &&
          matchesBodyguardKeywords(la, view.raw)
        )
          add(view);
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Lowercased union of a unit's `keywords` and `faction_keywords`, for membership tests. */
function unitKeywordSet(unit: Unit): Set<string> {
  const out = new Set<string>();
  for (const k of unit.keywords ?? []) out.add(k.toLowerCase());
  for (const k of unit.faction_keywords ?? []) out.add(k.toLowerCase());
  return out;
}

/**
 * Does `unit` satisfy an attachment entry's optional keyword eligibility — i.e.
 * its keyword set (keywords ∪ faction_keywords, case-insensitive) contains ALL
 * of `eligible_bodyguard_keywords`? Absent/empty keywords never match (the entry
 * then relies solely on `eligible_bodyguard_ids`).
 */
function matchesBodyguardKeywords(la: LeaderAttachment, unit: Unit): boolean {
  const req = la.eligible_bodyguard_keywords;
  if (!req || req.length === 0) return false;
  const have = unitKeywordSet(unit);
  return req.every((k) => have.has(k.toLowerCase()));
}

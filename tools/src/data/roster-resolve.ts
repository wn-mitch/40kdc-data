/**
 * Bridge helpers between the importer's flat-data {@link Roster} types and
 * the linked {@link UnitView} the cruncher consumes. The importer ships
 * unit entries as plain interfaces (`RosterUnit` is data, not behaviour),
 * so the lookup is a free function rather than a method.
 *
 * @packageDocumentation
 */
import type { BattleSize, Roster, RosterDetachment, RosterUnit, RosterWargear } from "../import/types.js";
import type { Detachment } from "../generated.js";
import type { Dataset } from "./dataset.js";
import type { UnitView, WeaponView } from "./entities.js";
import {
  detachmentCapForBattleSize,
  enhancementLimitForBattleSize,
  pointsLimitForBattleSize,
  unitLimitForBattleSize,
} from "./battle-sizes.js";
import { meetsEnhancementGroups } from "./enhancement-eligibility.js";
import { checkUnitLegality, type Violation } from "./loadout.js";
import { hostUnitPoints, wargearPoints } from "./pricing.js";

/**
 * Resolve a roster's unit entry against the dataset, returning the linked
 * {@link UnitView}. Returns `undefined` when:
 *   - the roster's `ref.id` is `null` (the importer couldn't match the unit), or
 *   - the id doesn't appear in the dataset (e.g. the roster was authored
 *     against an older dataslate than the bundled one).
 *
 * Doesn't surface diagnostics — the caller already has them on the roster's
 * own `diagnostics` field.
 */
export function resolveRosterUnit(
  rosterUnit: RosterUnit,
  dataset: Dataset,
  factionId?: string | null,
): UnitView | undefined {
  const id = rosterUnit.ref.id;
  if (id === null) return undefined;
  // A shared chassis (e.g. `chaos-terminators` in World Eaters *and* Emperors
  // Children) genuinely diverges per faction — different points, options, and
  // composition — so resolve the roster's own faction copy when known. Fall back
  // to first-wins `getAny` (which opts out of the units guard) when the roster
  // carries no faction or the faction has no copy of this id.
  if (factionId) {
    const scoped = dataset.units.getInFaction(id, factionId);
    if (scoped) return scoped;
  }
  return dataset.units.getAny(id);
}

/**
 * Resolve every wargear entry on a roster unit to a {@link WeaponView},
 * keeping each entry's count alongside. Unresolved entries are dropped
 * silently (matching {@link resolveRosterUnit}). Useful when the SPA
 * needs to enumerate firing options after the user picks a roster unit.
 */
export function resolveRosterWargear(
  wargear: RosterWargear[],
  dataset: Dataset,
): { weapon: WeaponView; count: number }[] {
  const out: { weapon: WeaponView; count: number }[] = [];
  for (const w of wargear) {
    const id = w.ref.id;
    if (id === null) continue;
    // Roster wargear refs carry no faction context — first-wins via getAny.
    const weapon = dataset.weapons.getAny(id);
    if (!weapon) continue;
    out.push({ weapon, count: w.count });
  }
  return out;
}

/** The loadout-legality verdict for one resolved roster unit. */
export interface UnitLegality {
  /** Resolved unit id. */
  unitId: string;
  /** The unit's position in `roster.units` (source order). */
  unitIndex: number;
  /** Model count the loadout was checked against. */
  modelCount: number;
  /** Every count/swap rule the unit's loadout breaks; empty when legal. */
  violations: Violation[];
}

/**
 * Check every resolved unit in a roster for loadout legality — the building
 * block for a "is this list legal" report (e.g. a tournament-organiser check).
 *
 * For each unit it resolves the unit, its authored wargear options and its
 * unit-composition models the same way the loadout conformance surface does
 * ({@link resolveRosterUnit} → {@link Dataset.wargearOptionsOf} →
 * `unitCompositions` by `unit_id`), sums the roster's per-weapon counts, and
 * runs {@link validateLoadout}. The check is non-destructive and never alters
 * the roster: an illegal list still imports, it just reports violations — so a
 * TO can load a player's list verbatim and see exactly what's wrong rather than
 * have counts silently clamped or the import rejected.
 *
 * Returns one {@link UnitLegality} per **resolved** unit, in source order, with
 * an empty `violations` array when the unit is legal (the entries double as a
 * record of what was checked). Units the importer couldn't resolve (`ref.id`
 * null, or an id absent from the dataset) are skipped — they're already flagged
 * on the roster's `diagnostics`, and there's no datasheet to check them against.
 * A roster is fully legal iff every entry's `violations` is empty **and** the
 * roster reports no unresolved units.
 */
export function checkRosterLegality(roster: Roster, dataset: Dataset): UnitLegality[] {
  const out: UnitLegality[] = [];
  roster.units.forEach((rosterUnit, unitIndex) => {
    const view = resolveRosterUnit(rosterUnit, dataset, roster.faction_id);
    if (!view) return;
    // Options and composition are faction-scoped off the resolved unit's own
    // faction, so a shared chassis is checked against the right faction's rules.
    const options = dataset.wargearOptionsOf(view.raw);
    const composition = dataset.unitCompositionOf(view.raw);
    const counts = new Map<string, number>();
    for (const w of rosterUnit.wargear) {
      const id = w.ref.id;
      if (id === null) continue;
      counts.set(id, (counts.get(id) ?? 0) + w.count);
    }
    out.push({
      unitId: view.id,
      unitIndex,
      modelCount: rosterUnit.model_count,
      violations: checkUnitLegality(
        view.raw,
        rosterUnit.model_count,
        options,
        counts,
        composition?.models,
        composition?.tiers,
      ),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Roster-level (army) legality — the nine army-construction dimensions layered
// over the per-unit loadout check. `checkRosterLegality` above stays the
// per-unit layer; `checkRoster` composes it with the army checks below.
// ---------------------------------------------------------------------------

/** Army-construction violation codes (distinct from per-unit loadout codes). */
export type RosterViolationCode =
  | "enhancement-wrong-detachment"
  | "enhancement-on-non-character"
  | "enhancement-on-epic-hero"
  | "enhancement-on-excluded-model"
  | "enhancement-keyword-mismatch"
  | "enhancement-excluded-keyword"
  | "enhancement-over-max-targets"
  | "leader-attachment-illegal"
  | "leader-must-attach"
  | "points-over-limit"
  | "detachment-points-over"
  | "disposition-not-picked"
  | "disposition-invalid"
  | "detachment-tag-conflict"
  | "detachment-restriction-required"
  | "detachment-restriction-excluded"
  | "unit-excluded-from-faction"
  | "no-warlord"
  | "multiple-warlords"
  | "warlord-not-mandated"
  | "detachment-excluded-datasheet"
  | "keyword-limit-exceeded"
  | "unit-limit-exceeded"
  | "enhancement-limit-exceeded"
  | "ally-pool-not-offered"
  | "ally-points-over-limit"
  | "ally-cannot-be-warlord"
  | "ally-cannot-take-enhancements"
  | "unit-minimum-unmet";

/** One army-level legality violation. */
export interface RosterViolation {
  code: RosterViolationCode;
  /** Offending entity id (enhancement/unit/keyword/tag), or "roster" for army-wide. */
  id: string;
  message: string;
  /** Index into the roster's units for unit-scoped codes; null for army-wide. */
  unitIndex: number | null;
  /**
   * `warn` for advisory codes (force disposition — provisional 11e data),
   * `error` otherwise. A roster is legal iff it has no `error` violations.
   */
  severity: "error" | "warn";
}

/** The full roster-legality verdict: per-unit loadout + army-construction. */
export interface RosterLegality {
  units: UnitLegality[];
  army: RosterViolation[];
}

/** One unit in the normalised roster the core checker consumes. */
interface NormUnit {
  unitId: string;
  modelCount: number;
  isWarlord: boolean;
  keywordOverrides?: string[];
  enhancementId: string | null;
  leaderBodyguardId: string | null;
  counts: Map<string, number>;
}

/**
 * Normalised roster input shared by {@link checkRoster} (from a full {@link Roster})
 * and the `check_roster_legality` runner op (from a compact spec), so the two
 * entry points run the exact same checks.
 */
export interface NormRoster {
  factionId: string | null;
  battleSize: BattleSize | null;
  forceDisposition: string | null;
  detachmentIds: string[];
  units: NormUnit[];
}

/**
 * The shared roster-legality core. Runs the per-unit loadout check on every
 * resolved unit, then the nine army-construction dimensions. `unitIndex` on a
 * unit-scoped violation indexes `spec.units` (= the roster's unit order).
 */
export function validateRosterCore(spec: NormRoster, dataset: Dataset): RosterLegality {
  const army: RosterViolation[] = [];
  const push = (
    severity: "error" | "warn",
    code: RosterViolationCode,
    id: string,
    message: string,
    unitIndex: number | null = null,
  ) => army.push({ code, id, message, unitIndex, severity });
  const err = (
    code: RosterViolationCode,
    id: string,
    message: string,
    unitIndex: number | null = null,
  ) => push("error", code, id, message, unitIndex);

  const resolveUnit = (unitId: string): UnitView | undefined => {
    if (!unitId) return undefined;
    if (spec.factionId) {
      const scoped = dataset.units.getInFaction(unitId, spec.factionId);
      if (scoped) return scoped;
    }
    return dataset.units.getAny(unitId);
  };
  // The army faction's keywords ([Imperium, Adeptus Astartes, Blood Angels]
  // for a chapter): every unit in the faction's pool owns them — the
  // <CHAPTER>-style keyword that chapter-shared datasheet records can't
  // carry. Granted with the same subset rule that scopes a chapter's unit
  // pool, so allied units never gain them.
  const armyKeywords: string[] = spec.factionId
    ? (dataset.factions.get(spec.factionId)?.raw.keywords ?? [])
    : [];
  const armyKeywordSet = new Set<string>(armyKeywords);
  const keywordSet = (view: UnitView, unit?: NormUnit): Set<string> => {
    const owned = new Set<string>([
      ...(view.raw.keywords ?? []),
      ...(view.raw.faction_keywords ?? []),
      view.raw.name,
    ]);
    const factionKws = view.raw.faction_keywords ?? [];
    if (armyKeywordSet.size > 0 && factionKws.every((k) => armyKeywordSet.has(k))) {
      for (const k of armyKeywords) owned.add(k);
    }
      for (const grant of view.raw.conditional_keywords ?? []) {
        if (
          grant.required_detachment_id &&
          !spec.detachmentIds.includes(grant.required_detachment_id)
        ) {
          continue;
        }
        if (
          grant.required_faction_keyword &&
          !armyKeywordSet.has(grant.required_faction_keyword)
        ) {
          continue;
        }
        owned.add(grant.keyword);
      }
    for (const keyword of unit?.keywordOverrides ?? []) owned.add(keyword);
    return owned;
  };
  const isCharacter = (view: UnitView): boolean => {
    const r = view.raw.role;
    return r === "character" || r === "epic-hero" || (view.raw.keywords ?? []).includes("Character");
  };

  const views = spec.units.map((u) => resolveUnit(u.unitId));

  // --- Per-unit loadout (reuse the tier/bounds checker). --------------------
  const units: UnitLegality[] = [];
  spec.units.forEach((su, idx) => {
    const view = views[idx];
    if (!view) return;
    const options = dataset.wargearOptionsOf(view.raw);
    const composition = dataset.unitCompositionOf(view.raw);
    units.push({
      unitId: view.id,
      unitIndex: idx,
      modelCount: su.modelCount,
      violations: checkUnitLegality(
        view.raw,
        su.modelCount,
        options,
        su.counts,
        composition?.models,
        composition?.tiers,
      ),
    });
  });

  // Shared detachment ids (Codex chapters) resolve within the roster's
  // faction; fall back first-wins when the spec names no faction.
  const detachments = spec.detachmentIds
    .map(
      (id) =>
        (spec.factionId ? dataset.detachments.getInFaction(id, spec.factionId) : undefined) ??
        dataset.detachments.getAny(id),
    )
    .filter((d): d is Detachment => d !== undefined);

  // --- Enhancements: per-unit eligibility + army-wide uniqueness. -----------
  const enhUses = new Map<string, number>();
  spec.units.forEach((su, idx) => {
    if (!su.enhancementId) return;
    enhUses.set(su.enhancementId, (enhUses.get(su.enhancementId) ?? 0) + 1);
    const enh = dataset.enhancements.get(su.enhancementId);
    const view = views[idx];
    if (!enh || !view) return;
    if (!spec.detachmentIds.includes(enh.detachment_id))
      err("enhancement-wrong-detachment", enh.id, `${enh.id} is not from a detachment in this roster`, idx);
    if (
      !isCharacter(view) &&
      !su.keywordOverrides?.includes("Character") &&
      enh.upgrade_tag !== true
    )
      err("enhancement-on-non-character", enh.id, `${enh.id} can only be taken by a Character`, idx);
    // 11e Select Enhancements: EPIC HERO models cannot be given Enhancements (Upgrades included).
    if (view.raw.role === "epic-hero" || keywordSet(view, su).has("Epic Hero"))
      err("enhancement-on-epic-hero", enh.id, `${enh.id} cannot be given to Epic Hero ${view.id}`, idx);
    // A unit whose every model is `excluded_from_enhancements` (Ogryn Bodyguard,
    // Transcendent C'tan) has no model that can carry the Enhancement.
    const rows = dataset.unitCompositionOf(view.raw)?.models ?? [];
    if (rows.length > 0 && rows.every((m) => m.excluded_from_enhancements === true))
      err("enhancement-on-excluded-model", enh.id, `${enh.id} cannot be given to ${view.id}: no model in it can take Enhancements`, idx);
    const kws = keywordSet(view, su);
    const eligible = meetsEnhancementGroups(enh, view.id, (keyword) => kws.has(keyword));
    if (!eligible)
      err("enhancement-keyword-mismatch", enh.id, `${view.id} lacks an eligible keyword group for ${enh.id}`, idx);
    if ((enh.exclusion_keywords ?? []).some((k) => kws.has(k)))
      err("enhancement-excluded-keyword", enh.id, `${view.id} carries a keyword excluded by ${enh.id}`, idx);
  });
  for (const [enhId, uses] of enhUses) {
    const max = dataset.enhancements.get(enhId)?.max_targets ?? 1;
    if (uses > max) err("enhancement-over-max-targets", enhId, `${enhId} taken ${uses} times, max ${max}`);
  }

  // --- Leader attachment. ----------------------------------------------------
  const rosterUnitIds = new Set(views.filter((v): v is UnitView => v !== undefined).map((v) => v.id));
  spec.units.forEach((su, idx) => {
    const view = views[idx];
    if (!view) return;
    if (su.leaderBodyguardId) {
      // Every game mode: legality of a saved roster's attachment is a lookup, and a
      // Combat Patrol bodyguard named by id must still count as eligible.
      const eligible = new Set(
        dataset
          .forGameMode("all")
          .bodyguardsAttachableFrom(view.id, spec.factionId ?? undefined, rosterUnitIds)
          .map((v) => v.id),
      );
      const enhancement = su.enhancementId ? dataset.enhancements.get(su.enhancementId) : undefined;
      for (const bodyguardId of enhancement?.attachment_bodyguard_ids ?? []) eligible.add(bodyguardId);
      if (!eligible.has(su.leaderBodyguardId))
        err("leader-attachment-illegal", view.id, `${view.id} cannot attach to ${su.leaderBodyguardId}`, idx);
    } else if (
      (dataset.conditionalAttachmentRole(view.id, rosterUnitIds) ?? view.raw.attachment_role) === "support" &&
      (isCharacter(view) || su.keywordOverrides?.includes("Character") === true)
    ) {
      err("leader-must-attach", view.id, `${view.id} is a Support character and must attach to a unit`, idx);
    }
  });

  // --- Points total (ordinal-aware) + wargear + enhancement costs. ----------
  // Host-aware: a foreign unit with an allied_points entry for this army
  // (Agents' Imperium price, a chapter's reprice of a shared datasheet)
  // prices from that entry, not its native table; a `detachment_pricing` entry
  // for a selected detachment (Pantheon of Woe's C'tan) overrides both.
  const rosterFaction = spec.factionId ? dataset.factions.get(spec.factionId)?.raw : undefined;
  const ordinals = new Map<string, number>();
  const unitCosts: number[] = spec.units.map(() => 0);
  let total = 0;
  spec.units.forEach((su, idx) => {
    const view = views[idx];
    if (!view) return;
    const ord = (ordinals.get(su.unitId) ?? 0) + 1;
    ordinals.set(su.unitId, ord);
    let cost = hostUnitPoints(view.raw, su.modelCount, ord, rosterFaction, spec.detachmentIds);
    cost += wargearPoints(view.raw, su.counts);
    if (su.enhancementId) cost += dataset.enhancements.get(su.enhancementId)?.cost ?? 0;
    unitCosts[idx] = cost;
    total += cost;
  });
  const limit = pointsLimitForBattleSize(spec.battleSize);
  if (limit !== null && total > limit)
    err("points-over-limit", "roster", `army totals ${total}, over the ${limit} limit`);

  // --- Detachment-point budget. ---------------------------------------------
  const cap = detachmentCapForBattleSize(spec.battleSize);
  const dpUsed = detachments.reduce((s, d) => s + (d.detachment_points ?? 0), 0);
  if (cap !== null && dpUsed > cap)
    err("detachment-points-over", "roster", `detachments cost ${dpUsed} DP, over the ${cap} budget`);

  // --- Force disposition (advisory / warn). ---------------------------------
  // Any selected detachment may grant the pick; detachments whose data does
  // not record force_dispositions are skipped, and when none record them the
  // check is inconclusive and stays silent.
  if (spec.forceDisposition == null) {
    push("warn", "disposition-not-picked", "roster", "no Force Disposition selected");
  } else {
    const recorded = detachments.filter((d) => d.force_dispositions);
    if (recorded.length > 0 && !recorded.some((d) => d.force_dispositions!.includes(spec.forceDisposition!))) {
      push("warn", "disposition-invalid", spec.forceDisposition, `${spec.forceDisposition} is not offered by any selected detachment`);
    }
  }

  // --- Detachment tag uniqueness (one per shared tag). ----------------------
  const tagCounts = new Map<string, number>();
  for (const d of detachments) for (const t of d.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  for (const [tag, n] of tagCounts)
    if (n > 1) err("detachment-tag-conflict", tag, `${n} detachments share the '${tag}' tag`);

  // --- Detachment restrictions (required/excluded army keywords, per unit). -
  for (const d of detachments) {
    const r = d.restrictions;
    if (!r) continue;
    spec.units.forEach((su, idx) => {
      const view = views[idx];
      if (!view) return;
      const kws = keywordSet(view, su);
      if ((r.required_keywords ?? []).some((k) => !kws.has(k)))
        err("detachment-restriction-required", view.id, `${view.id} lacks a keyword required by ${d.id}`, idx);
      if ((r.excluded_keywords ?? []).some((k) => kws.has(k)))
        err("detachment-restriction-excluded", view.id, `${view.id} carries a keyword excluded by ${d.id}`, idx);
    });
  }

  // --- Faction exclusions (a generic unit barred from this army's chapter). --
  // The shared Space Marine pool can't drop a generic datasheet for one chapter,
  // so a removed-without-replacement unit (e.g. Librarians for Black Templars)
  // carries `excluded_faction_keywords`; it is illegal when the army's faction
  // keywords intersect that list.
  const factionKeywords = spec.factionId
    ? new Set<string>(dataset.factions.get(spec.factionId)?.raw.keywords ?? [])
    : new Set<string>();
  if (factionKeywords.size) {
    spec.units.forEach((su, idx) => {
      const view = views[idx];
      if (!view) return;
      const barred = (view.raw.excluded_faction_keywords ?? []).filter((k) => factionKeywords.has(k));
      if (barred.length)
        err(
          "unit-excluded-from-faction",
          view.id,
          `${view.id} cannot be taken by ${spec.factionId} (barred by ${barred.join(", ")})`,
          idx,
        );
    });
  }

  // --- Warlord present (exactly one). ---------------------------------------
  const warlords = spec.units.filter((su) => su.isWarlord).length;
  if (warlords === 0) err("no-warlord", "roster", "army has no warlord");
  else if (warlords > 1) err("multiple-warlords", "roster", `army has ${warlords} warlords`);

  // --- Detachment Warlord requirement (e.g. Devoted of Ynnead). -------------
  // Checked only when a Warlord is chosen; a missing one is `no-warlord` above.
  for (const d of detachments) {
    const mandated = d.mandatory_warlord_datasheet_ids ?? [];
    if (mandated.length === 0 || warlords === 0) continue;
    if (!spec.units.some((su) => su.isWarlord && mandated.includes(su.unitId)))
      err("warlord-not-mandated", d.id, `${d.id} requires the Warlord to be one of: ${mandated.join(", ")}`);
  }

  // --- Detachment datasheet exclusions (e.g. Shadow Legion). ----------------
  for (const d of detachments) {
    const excluded = d.excluded_datasheet_ids ?? [];
    if (excluded.length === 0) continue;
    spec.units.forEach((su, idx) => {
      if (excluded.includes(su.unitId))
        err("detachment-excluded-datasheet", su.unitId, `${su.unitId} cannot be included with ${d.id}`, idx);
    });
  }

  // --- Unit limit per datasheet (11e Select Battle Size). -------------------
  // Units sharing a datasheet: at most the battle size's unit limit (incursion
  // 2, strike-force 3), doubled for BATTLELINE (including detachment-granted
  // Battleline) and DEDICATED TRANSPORT units; every EPIC HERO is limited to 1.
  const unitLimit = unitLimitForBattleSize(spec.battleSize);
  const copies = new Map<string, { count: number; limit: number }>();
  spec.units.forEach((su, idx) => {
    const view = views[idx];
    if (!view) return;
    const kws = keywordSet(view, su);
    const role = view.raw.role;
    let limit: number | null = unitLimit;
    if (role === "epic-hero" || kws.has("Epic Hero")) limit = 1;
    else if (limit !== null && (role === "battleline" || role === "dedicated-transport" || kws.has("Battleline") || kws.has("Dedicated Transport")))
      limit *= 2;
    if (limit === null) return;
    const entry = copies.get(view.id) ?? { count: 0, limit };
    entry.count += 1;
    entry.limit = Math.max(entry.limit, limit);
    copies.set(view.id, entry);
  });
  for (const [id, { count, limit }] of copies)
    if (count > limit) err("unit-limit-exceeded", id, `army includes ${count} ${id} units, over the limit of ${limit}`);

  // --- Enhancement limit (11e Select Battle Size: incursion 2, strike-force 4).
  // Counted as distinct Enhancements chosen: an upgrade applied to several units
  // is one Enhancement choice.
  const enhancementLimit = enhancementLimitForBattleSize(spec.battleSize);
  const enhancementsChosen = new Set(spec.units.flatMap((su) => (su.enhancementId ? [su.enhancementId] : []))).size;
  if (enhancementLimit !== null && enhancementsChosen > enhancementLimit)
    err("enhancement-limit-exceeded", "roster", `army takes ${enhancementsChosen} Enhancements, over the limit of ${enhancementLimit}`);

  // --- Army-wide keyword caps (faction `keyword_limits`). -------------------
  // Units with an exempt faction keyword never count. `units` mode counts units
  // carrying every keyword (keywords, faction keywords or name); `alternatives`
  // mode counts how many of the keywords appear on any unit (Farsight / Ethereal). A selected detachment's
  // `keyword_limit_overrides` entry for the same keyword set replaces `max`
  // (the largest wins when several detachments override it).
  const sameKeywords = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && [...a].sort().every((k, i) => k === [...b].sort()[i]);
  for (const kl of rosterFaction?.keyword_limits ?? []) {
    let max = kl.max;
    let overridden = false;
    for (const d of detachments)
      for (const o of d.keyword_limit_overrides ?? [])
        if (sameKeywords(o.keywords, kl.keywords)) {
          max = overridden ? Math.max(max, o.max) : o.max;
          overridden = true;
        }
    const exempt = kl.exempt_faction_keywords ?? [];
    const counted = spec.units
      .map((su, idx) => ({ su, view: views[idx] }))
      .filter(({ view }) => view && !(view.raw.faction_keywords ?? []).some((k) => exempt.includes(k)))
      .map(({ su, view }) => keywordSet(view!, su));
    // `units`: units carrying every keyword. `alternatives`: distinct keywords present.
    const count =
      kl.mode === "alternatives"
        ? kl.keywords.filter((k) => counted.some((kws) => kws.has(k))).length
        : counted.filter((kws) => kl.keywords.every((k) => kws.has(k))).length;
    if (count > max) {
      const id = [...kl.keywords].sort().join("+");
      err("keyword-limit-exceeded", id, `army includes ${count} of ${id}, over the limit of ${max}`);
    }
  }

  // --- Exclusive allied pools (the army faction's own pool-only units). -----
  // Units listed by an `exclusive` rule drawn from the army faction can only be
  // taken through that rule, so their pool is known without per-unit attribution:
  // the rule must be offered (army keyword + detachment gates), and its points cap
  // and Warlord/Enhancement locks apply. A selected detachment that names a unit
  // for Warlord (mandatory or granted) lifts the Warlord lock for it.
  const detachmentWarlords = new Set<string>(
    detachments.flatMap((d) => [...(d.mandatory_warlord_datasheet_ids ?? []), ...(d.granted_warlord_datasheet_ids ?? [])]),
  );
  for (const rule of dataset.alliedRules.all) {
    if (!rule.exclusive || !spec.factionId || rule.source_faction_id !== spec.factionId) continue;
    const pool = new Set(rule.source_datasheet_ids ?? []);
    const members = spec.units
      .map((su, idx) => ({ su, idx, view: views[idx] }))
      .filter(({ su, view }) => view !== undefined && view.raw.faction_id === spec.factionId && pool.has(su.unitId));
    if (members.length === 0) continue;
    const armyGate =
      (rule.army_keywords_any ?? []).length === 0 ||
      (rule.army_keywords_any ?? []).some((k) => armyKeywordSet.has(k));
    const detachmentGate =
      (rule.detachment_ids ?? []).length === 0 ||
      (rule.detachment_ids ?? []).some((id) => spec.detachmentIds.includes(id));
    if (!armyGate || !detachmentGate)
      for (const { su, idx } of members)
        err("ally-pool-not-offered", su.unitId, `${su.unitId} is only available through ${rule.id}, which this army does not offer`, idx);
    const cap = (rule.points_limits ?? []).find((p) => p.battle_size === spec.battleSize)?.max_points;
    if (cap != null) {
      const spent = members.reduce((sum, { idx }) => sum + unitCosts[idx], 0);
      if (spent > cap) err("ally-points-over-limit", rule.id, `${rule.id} units total ${spent}, over the ${cap} limit`);
    }
    for (const { su, idx } of members) {
      if (rule.cannot_be_warlord && su.isWarlord && !detachmentWarlords.has(su.unitId))
        err("ally-cannot-be-warlord", su.unitId, `${su.unitId} cannot be Warlord under ${rule.id}`, idx);
      if (rule.cannot_take_enhancements && su.enhancementId)
        err("ally-cannot-take-enhancements", su.unitId, `${su.unitId} cannot take an Enhancement under ${rule.id}`, idx);
    }
  }

  // --- Unit minimums (e.g. Houndpack: 3+ WAR DOG units). --------------------
  for (const d of detachments) {
    for (const um of d.unit_minimums ?? []) {
      const count = views.filter(
        (view, index) =>
          view !== undefined && keywordSet(view, spec.units[index]).has(um.keyword),
      ).length;
      if (count < um.min)
        err("unit-minimum-unmet", um.keyword, `${d.id} requires ${um.min}+ ${um.keyword} units, found ${count}`);
    }
  }

  army.sort((a, b) => (a.code === b.code ? a.id.localeCompare(b.id) : a.code.localeCompare(b.code)));
  return { units, army };
}

/**
 * Whole-army legality for a resolved {@link Roster}: the per-unit loadout check
 * plus the nine army-construction dimensions (enhancements, leader attachment,
 * points, detachment points, force disposition, detachment tags/restrictions/
 * datasheet exclusions, warlord presence and detachment Warlord requirement,
 * unit minimums). A roster is legal iff `army` has no `error`-severity
 * entries and every `units[].violations` is empty.
 */
export function checkRoster(roster: Roster, dataset: Dataset): RosterLegality {
  const spec: NormRoster = {
    factionId: roster.faction_id,
    battleSize: roster.battle_size,
    forceDisposition: roster.force_disposition,
    detachmentIds: roster.detachments
      .map((d) => d.ref.id)
      .filter((id): id is string => id !== null),
    units: roster.units.map((u) => {
      const counts = new Map<string, number>();
      for (const w of u.wargear) {
        if (w.ref.id === null) continue;
        counts.set(w.ref.id, (counts.get(w.ref.id) ?? 0) + w.count);
      }
      return {
        unitId: u.ref.id ?? "",
        modelCount: u.model_count,
        isWarlord: u.is_warlord,
        keywordOverrides: u.keyword_overrides ?? [],
        enhancementId: u.enhancement?.id ?? null,
        leaderBodyguardId: u.leader_attachment?.bodyguard_ref.id ?? null,
        counts,
      };
    }),
  };
  return validateRosterCore(spec, dataset);
}

/**
 * The roster's leader entry attached to `bodyguardUnitId`, if any. Import
 * stores the inferred (always-provisional) attachment on the *leader's*
 * {@link RosterUnit}, pointing down to its bodyguard via
 * `leader_attachment.bodyguard_ref`. Selection UIs start from the body unit,
 * so this scans for the leader whose `bodyguard_ref.id` matches. Returns
 * `undefined` when no leader in the roster is attached to that unit (the
 * common case — attachments are optional at game start).
 */
export function resolveAttachedLeader(
  roster: Roster,
  bodyguardUnitId: string,
): RosterUnit | undefined {
  return roster.units.find(
    (u) => u.leader_attachment?.bodyguard_ref.id === bodyguardUnitId,
  );
}

/**
 * Every roster unit attached to `unitId`, resolved from *either* end of the
 * attachment. A leader+bodyguard are one combined unit, so a selection UI may
 * start from either half:
 *   - `unitId` is the **bodyguard** → the leader(s) whose
 *     `leader_attachment.bodyguard_ref.id` points at it (body-first, the
 *     {@link resolveAttachedLeader} direction), and
 *   - `unitId` is a **leader** → its bodyguard and every other leader in the
 *     same attachment.
 * Returns the partner {@link RosterUnit}s (deduped, source order). Empty when
 * the unit has no attachment in this roster — the common case, since
 * attachments are optional at game start. Shaped as a list to carry 11th
 * edition's multi-member attachments without an API change.
 */
export function resolveAttachmentPartners(
  roster: Roster,
  unitId: string,
): RosterUnit[] {
  const memberIds = attachmentMemberIds(roster, unitId);
  const partners = new Set<RosterUnit>();
  for (const unit of roster.units) {
    if (unit.ref.id !== null && unit.ref.id !== unitId && memberIds.has(unit.ref.id)) partners.add(unit);
  }
  return [...partners];
}

/** Actual attachment roles, independent of CHARACTER keywords or the Leader ability. */
export function resolveAttachmentRoles(
  roster: Roster,
  unitId: string,
): Readonly<Record<string, "leader" | "bodyguard">> {
  const memberIds = attachmentMemberIds(roster, unitId);
  const roles: Record<string, "leader" | "bodyguard"> = {};
  for (const unit of roster.units) {
    const id = unit.ref.id;
    const bodyguardId = unit.leader_attachment?.bodyguard_ref.id;
    if (id === null || !memberIds.has(id) || bodyguardId == null || !memberIds.has(bodyguardId)) continue;
    roles[id] = "leader";
    roles[bodyguardId] ??= "bodyguard";
  }
  return roles;
}

function attachmentMemberIds(roster: Roster, unitId: string): Set<string> {
  const present = new Set(roster.units.flatMap((unit) => unit.ref.id === null ? [] : [unit.ref.id]));
  const members = new Set<string>();
  if (!present.has(unitId)) return members;
  members.add(unitId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of roster.units) {
      const id = unit.ref.id;
      const bodyguardId = unit.leader_attachment?.bodyguard_ref.id;
      if (id === null || bodyguardId == null || !present.has(bodyguardId)) continue;
      if (!members.has(id) && !members.has(bodyguardId)) continue;
      if (!members.has(id) || !members.has(bodyguardId)) changed = true;
      members.add(id);
      members.add(bodyguardId);
    }
  }
  return members;
}

/**
 * The roster's **primary detachment** — the first in source order. 11th
 * edition rosters may field several detachments under a detachment-point cap,
 * but single-detachment consumers (and every pre-11e list) just want "the"
 * detachment. This names that choice so callers stop reaching into
 * `detachments[0]` directly. Returns `undefined` only when the roster carries
 * no detachment at all (the source declared none, or none parsed).
 */
export function primaryDetachment(roster: Roster): RosterDetachment | undefined {
  return roster.detachments[0];
}

/**
 * The resolved entity id of the {@link primaryDetachment}. `null` when the
 * roster carries no detachment, or when the primary one failed to resolve to a
 * known id (the raw name is still retained on the detachment's `ref`).
 */
export function primaryDetachmentId(roster: Roster): string | null {
  return roster.detachments[0]?.ref.id ?? null;
}

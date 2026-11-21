/**
 * Allied-pool attribution, caps and locks for the roster checker
 * ({@link validateRosterCore}). Mirrored by Rust `data/roster_allies.rs`, Python
 * `data/roster_allies.py` and Go `roster_allies.go`; pinned by the
 * `roster_validation` conformance corpus.
 *
 * @packageDocumentation
 */
import type { BattleSize } from "../import/types.js";
import type { AlliedRule } from "../generated.js";
import type { Dataset } from "./dataset.js";
import type { UnitView } from "./entities.js";

/** A violation the allied-pool checks raise; `unitIndex` is null for an army-level one. */
export interface AllyViolation {
  code:
    | "ally-points-over-limit"
    | "ally-cannot-be-warlord"
    | "ally-cannot-take-enhancements"
    | "ally-battleline-ratio-exceeded"
    | "ally-keyword-limit-exceeded"
    | "ally-keyword-limits-exclusive";
  id: string;
  message: string;
  unitIndex: number | null;
}

/** A roster unit included through an allied rule, as {@link allyPoolViolations} reads it. */
export interface AllyMember {
  unitId: string;
  /** Index into the roster's units. */
  index: number;
  /** The unit's roster cost (host-aware points, wargear and enhancement). */
  cost: number;
  isWarlord: boolean;
  hasEnhancement: boolean;
  /** True when the unit is BATTLELINE (role or keyword). */
  battleline: boolean;
  /** The unit's roster keyword set. */
  keywords: ReadonlySet<string>;
}

/**
 * The offered allied rule each foreign roster unit is included through, by
 * index into `views`. A unit is foreign when it belongs to another faction
 * (`faction_id` differs from the army's) and carries a Faction keyword the army
 * faction lacks — a chapter army's generic Space Marine units are not foreign.
 * A foreign unit is attributed to the first offered, non-`exclusive` rule
 * whose pool ({@link Dataset.allyUnitsFor}) lists its id; a unit no offered
 * pool lists is left unattributed. "First" is {@link Dataset.alliesFor} order,
 * the allied-rules data order (records sorted by id), which every port reads
 * from the same bundle: a Deathwatch army's Agents units fit both Agents pools
 * and count against `agents-of-the-imperium-allies`. Each foreign unit counts
 * against exactly one pool's caps.
 */
export function attributeAllies(
  dataset: Dataset,
  factionId: string | null,
  detachmentIds: string[],
  armyKeywords: ReadonlySet<string>,
  views: readonly (UnitView | undefined)[],
): Map<number, AlliedRule> {
  const out = new Map<number, AlliedRule>();
  if (!factionId) return out;
  const pools = dataset
    .alliesFor(factionId, detachmentIds)
    .filter((rule) => !rule.exclusive)
    .map((rule) => ({ rule, ids: new Set(dataset.allyUnitsFor(rule.id).map((u) => u.id)) }));
  views.forEach((view, idx) => {
    if (!view || view.raw.faction_id === factionId) return;
    if ((view.raw.faction_keywords ?? []).every((k) => armyKeywords.has(k))) return;
    const pool = pools.find((p) => p.ids.has(view.id));
    if (pool) out.set(idx, pool.rule);
  });
  return out;
}

/**
 * The keyword-cap violations of one allied rule over the keyword sets of the
 * units included through it. Keywords match case-insensitively.
 *
 * - **Caps** (`keyword_limits` at `battleSize`; none without a battle size):
 *   units carrying the keyword count, less the exempt ones — for each exemption,
 *   every included unit carrying all `donor_keywords` exempts one counted unit
 *   carrying all `receiver_keywords` (a unit is exempted at most once).
 * - **Alternatives** (`keyword_limits_exclusive`): the included units may carry
 *   only one of the rule's limited keywords, at any battle size.
 */
export function allyKeywordLimitViolations(
  rule: AlliedRule,
  members: readonly ReadonlySet<string>[],
  battleSize: BattleSize | null,
): AllyViolation[] {
  const out: AllyViolation[] = [];
  const lowered = members.map((kws) => new Set([...kws].map((k) => k.toLowerCase())));
  const hasAll = (kws: Set<string>, need: readonly string[]) => need.every((k) => kws.has(k.toLowerCase()));
  const limits = rule.keyword_limits ?? [];
  for (const limit of limits) {
    if (battleSize === null || limit.battle_size !== battleSize) continue;
    const counted = lowered.flatMap((kws, i) => (kws.has(limit.keyword.toLowerCase()) ? [i] : []));
    const exempt = new Set<number>();
    for (const ex of limit.exemptions ?? []) {
      let donors = lowered.filter((kws) => hasAll(kws, ex.donor_keywords)).length;
      for (const i of counted) {
        if (donors === 0) break;
        if (exempt.has(i) || !hasAll(lowered[i], ex.receiver_keywords)) continue;
        exempt.add(i);
        donors -= 1;
      }
    }
    const count = counted.length - exempt.size;
    if (count > limit.max_count)
      out.push({
        code: "ally-keyword-limit-exceeded",
        id: `${rule.id}:${limit.keyword}`,
        message: `${rule.id} includes ${count} ${limit.keyword} units, over the limit of ${limit.max_count}`,
        unitIndex: null,
      });
  }
  if (rule.keyword_limits_exclusive) {
    const keywords = [...new Set(limits.map((l) => l.keyword))];
    const used = keywords.filter((k) => lowered.some((kws) => kws.has(k.toLowerCase()))).sort();
    if (used.length > 1)
      out.push({
        code: "ally-keyword-limits-exclusive",
        id: rule.id,
        message: `${rule.id} allows only one of ${keywords.sort().join(", ")}; the army includes ${used.join(" and ")} units`,
        unitIndex: null,
      });
  }
  return out;
}

/**
 * The pool-level violations of one allied rule over the units included through
 * it, in this order:
 *
 * - **Points cap** (`points_limits` at `battleSize`): the members' combined cost.
 * - **Warlord lock** (`cannot_be_warlord`): a member may not be the Warlord,
 *   unless a selected detachment names its datasheet for Warlord
 *   (`warlordExempt`).
 * - **Enhancement lock** (`cannot_take_enhancements`).
 * - **Battleline ratio** (`battleline_ratio_keywords`, at any battle size): for
 *   each keyword, the members carrying it that are not BATTLELINE may not
 *   outnumber those that are. Keywords match case-insensitively.
 */
export function allyPoolViolations(
  rule: AlliedRule,
  members: readonly AllyMember[],
  battleSize: BattleSize | null,
  warlordExempt: ReadonlySet<string>,
): AllyViolation[] {
  const out: AllyViolation[] = [];
  const cap = (rule.points_limits ?? []).find((p) => p.battle_size === battleSize)?.max_points;
  if (cap != null) {
    const spent = members.reduce((sum, m) => sum + m.cost, 0);
    if (spent > cap)
      out.push({
        code: "ally-points-over-limit",
        id: rule.id,
        message: `${rule.id} units total ${spent}, over the ${cap} limit`,
        unitIndex: null,
      });
  }
  for (const m of members) {
    if (rule.cannot_be_warlord && m.isWarlord && !warlordExempt.has(m.unitId))
      out.push({
        code: "ally-cannot-be-warlord",
        id: m.unitId,
        message: `${m.unitId} cannot be Warlord under ${rule.id}`,
        unitIndex: m.index,
      });
    if (rule.cannot_take_enhancements && m.hasEnhancement)
      out.push({
        code: "ally-cannot-take-enhancements",
        id: m.unitId,
        message: `${m.unitId} cannot take an Enhancement under ${rule.id}`,
        unitIndex: m.index,
      });
  }
  for (const keyword of rule.battleline_ratio_keywords ?? []) {
    const lower = keyword.toLowerCase();
    let battleline = 0;
    let other = 0;
    for (const m of members) {
      if (![...m.keywords].some((k) => k.toLowerCase() === lower)) continue;
      if (m.battleline) battleline += 1;
      else other += 1;
    }
    if (other > battleline)
      out.push({
        code: "ally-battleline-ratio-exceeded",
        id: `${rule.id}:${keyword}`,
        message: `${rule.id} includes ${other} non-Battleline ${keyword} units, more than its ${battleline} Battleline ${keyword} units`,
        unitIndex: null,
      });
  }
  return out;
}

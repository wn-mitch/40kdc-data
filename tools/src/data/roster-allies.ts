/**
 * Allied-pool attribution and keyword caps for the roster checker
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

/** An army-level violation the allied-pool checks raise. */
export interface AllyViolation {
  code: "ally-keyword-limit-exceeded" | "ally-keyword-limits-exclusive";
  id: string;
  message: string;
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
      });
  }
  return out;
}

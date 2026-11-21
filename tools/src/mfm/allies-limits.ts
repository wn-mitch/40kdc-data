/**
 * allies-limits.ts — the allied-pool construction fields `allies.ts` reads beside
 * the pool's own caps: the slotless keyword groups that exempt units from an
 * allied keyword cap, and the keyword-level Battleline-ratio flags.
 */
import type { MfmDump } from "./loader.js";

/** One donor/receiver pair exempting receiver units from an allied keyword cap. */
export interface AlliedKeywordLimitExemptionOut {
  donor_keywords: string[];
  receiver_keywords: string[];
}

/**
 * The slotless groups of one `allied_faction_keyword` row. For each included unit
 * carrying every donor keyword, one included unit carrying every receiver keyword
 * does not count towards the row's cap (Agents of the Imperium: one INQUISITORIAL
 * AGENTS unit per INQUISITOR unit is outside the RETINUE cap). Keywords are sorted
 * within a pair, pairs are deduplicated and sorted, and a group missing either side
 * throws: the dump never authors one, and a half group has no meaning to project.
 */
export function slotlessExemptions(dump: MfmDump, alliedFactionKeywordId: string): AlliedKeywordLimitExemptionOut[] {
  const kw = dump.byId("keyword");
  const groups = dump.groupBy("allied_faction_keyword_slotless_keyword_group", "alliedFactionKeywordId");
  const donors = dump.groupBy(
    "allied_faction_keyword_slotless_keyword_group_donor_keyword",
    "alliedFactionKeywordSlotlessKeywordGroupId",
  );
  const receivers = dump.groupBy(
    "allied_faction_keyword_slotless_keyword_group_receiver_keyword",
    "alliedFactionKeywordSlotlessKeywordGroupId",
  );
  const names = (rows: readonly { keywordId: string }[], groupId: string): string[] => {
    const out = new Set<string>();
    for (const r of rows) {
      const name = dump.enName(kw.get(r.keywordId));
      if (!name) throw new Error(`slotless group ${groupId}: keyword ${r.keywordId} has no name`);
      out.add(name);
    }
    return [...out].sort();
  };
  const pairs = new Map<string, AlliedKeywordLimitExemptionOut>();
  for (const group of groups.get(alliedFactionKeywordId) ?? []) {
    const donor_keywords = names(donors.get(group.id) ?? [], group.id);
    const receiver_keywords = names(receivers.get(group.id) ?? [], group.id);
    if (donor_keywords.length === 0 || receiver_keywords.length === 0)
      throw new Error(`slotless group ${group.id} lacks donor or receiver keywords`);
    pairs.set(JSON.stringify([donor_keywords, receiver_keywords]), { donor_keywords, receiver_keywords });
  }
  return [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);
}

/**
 * The Battleline-ratio keywords the dump flags for a pool sourcing any of
 * `parentFactionKeywordIds`: a keyword whose `allyRestrictingFactionKeywordId` is
 * one of them, with `allyRestrictingKeywordId` naming the keyword the ratio counts
 * against (Slaanesh → Legiones Daemonica / Battleline: under Daemonic Pact,
 * non-BATTLELINE SLAANESH units cannot outnumber BATTLELINE ones). Sorted by name.
 * The schema's `battleline_ratio_keywords` counts against BATTLELINE only, so any
 * other restricting keyword throws rather than projecting a different rule.
 */
export function battlelineRatioKeywords(dump: MfmDump, parentFactionKeywordIds: readonly string[]): string[] {
  const parents = new Set(parentFactionKeywordIds);
  const kw = dump.byId("keyword");
  const out = new Set<string>();
  for (const row of dump.table("keyword")) {
    if (!row.allyRestrictingFactionKeywordId || !parents.has(row.allyRestrictingFactionKeywordId)) continue;
    const name = dump.enName(row);
    const against = row.allyRestrictingKeywordId ? dump.enName(kw.get(row.allyRestrictingKeywordId)) : undefined;
    if (!name || against !== "Battleline")
      throw new Error(`keyword ${row.id}: ally restriction counts against ${against ?? "nothing"}, not Battleline`);
    out.add(name);
  }
  return [...out].sort();
}

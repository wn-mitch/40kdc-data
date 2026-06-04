import { Dataset } from "@alpaca-software/40kdc-data";
import type {
  Mission,
  MissionMatchup,
  ForceDispositionId,
  SecondaryCard,
  ScoreEntry,
} from "@alpaca-software/40kdc-data";

/** The embedded 40kdc dataset — the whole point of the demo is reading the
 *  linked, typed API: matchup → mission_id → mission. */
export const ds: Dataset = Dataset.embedded();

/** The five launch Force Dispositions, in the schema enum order. */
export const DISPOSITIONS: ForceDispositionId[] = [
  "take-and-hold",
  "disruption",
  "purge-the-foe",
  "priority-assets",
  "reconnaissance",
];

/** Display names. The core dataset ships no force-disposition records (only an
 *  `_example` file), so these factual objective names are kept here. */
export const DISPOSITION_LABELS: Record<ForceDispositionId, string> = {
  "take-and-hold": "Take and Hold",
  disruption: "Disruption",
  "purge-the-foe": "Purge the Foe",
  "priority-assets": "Priority Assets",
  reconnaissance: "Reconnaissance",
};

const pairKey = (own: ForceDispositionId, opp: ForceDispositionId): string =>
  `${own}|${opp}`;

// One lookup table keyed by (own disposition, opponent disposition).
const matchupByPair = new Map<string, MissionMatchup>();
for (const matchup of ds.missionMatchups) {
  matchupByPair.set(
    pairKey(matchup.disposition, matchup.opponent_disposition),
    matchup,
  );
}

/**
 * The mission a player with disposition `own` plays when their opponent reveals
 * disposition `opp`. Follows the linked API: the matchup names a `mission_id`,
 * which resolves to the mission entity.
 *
 * Note the asymmetry — a player reads their *own* card. To get the opponent's
 * mission for the same pairing, call `missionFor(opp, own)`.
 */
export function missionFor(
  own: ForceDispositionId,
  opp: ForceDispositionId,
): Mission | undefined {
  const matchup = matchupByPair.get(pairKey(own, opp));
  if (!matchup) return undefined;
  return ds.missions.get(matchup.mission_id);
}

/**
 * A mission's primary scoring card — the third link in the chain that this demo
 * exists to show off: disposition pair → matchup → mission, then
 * `mission.id` → its `card_type: "primary"` secondary-card (same id). Carries
 * the community `text` summary and the structured `awards` the readout humanizes.
 */
export function scoringCardFor(missionId: string): SecondaryCard | undefined {
  return ds.missionCards.get(missionId);
}

/**
 * The drawable secondary deck: every `card_type: "secondary"` card. The deck is
 * a single shared list (the Attacker/Defender printings are identical), so both
 * players draw from the same pool.
 */
export const SECONDARY_DECK: SecondaryCard[] = ds.missionCards.all.filter(
  (c) => c.card_type === "secondary",
);

const byId = new Map(SECONDARY_DECK.map((c) => [c.id, c] as const));

/** Resolve drawn card ids back to cards, dropping any that are unknown. */
export function secondariesByIds(ids: readonly string[]): SecondaryCard[] {
  return ids.map((id) => byId.get(id)).filter((c): c is SecondaryCard => c !== undefined);
}

/** A secondary's display name, or the raw id if unknown. */
export function secondaryName(id: string): string {
  return byId.get(id)?.name ?? id;
}

/**
 * Every card id out of the deck for one player: held in hand, scored (the
 * engine's log discards on score), or manually discarded. A card that leaves
 * the hand never re-enters the pool — tactical-deck semantics. `removeScore`
 * un-logs and returns the card to hand, so an undone score stays excluded via
 * `handIds` and a restored discard via the same route.
 */
export function excludedIds(
  handIds: readonly string[],
  log: readonly ScoreEntry[],
  discards: readonly string[],
): string[] {
  return [...new Set([...handIds, ...log.map((e) => e.cardId), ...discards])];
}

/**
 * Draw one random secondary still in the deck. `excluded` is the full
 * out-of-deck set (see `excludedIds`). Returns `undefined` once the deck is
 * exhausted. `rand` is injectable and `deck` overridable for determinism in
 * tests.
 */
export function drawSecondary(
  excluded: readonly string[],
  rand: () => number = Math.random,
  deck: readonly SecondaryCard[] = SECONDARY_DECK,
): SecondaryCard | undefined {
  const out = new Set(excluded);
  const pool = deck.filter((c) => !out.has(c.id));
  if (pool.length === 0) return undefined;
  return pool[Math.floor(rand() * pool.length)];
}

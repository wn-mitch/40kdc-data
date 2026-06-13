/**
 * The persisted match shape + cloud-save naming.
 *
 * `Saved` is the single JSON blob the app writes to localStorage and uploads to
 * the cloud (bridged through `session-doc` for live edits). It was lifted out of
 * App.svelte so the session adapter and the name generator can share the type.
 */
import type { ForceDispositionId, PlayerGame } from "@alpaca-software/40kdc-data";
import { DISPOSITION_LABELS } from "../../../_shared/matchup-grid.js";
import type { PrimaryTicksByRound } from "./data.js";

// Persisted match — v3 (the v1 single-player blob is intentionally ignored).
export const STORAGE_KEY = "mission-matrix.play-aid.v3";

export interface Saved {
  dispYou: ForceDispositionId | null;
  dispOpp: ForceDispositionId | null;
  round: number;
  gameYou: PlayerGame;
  gameOpp: PlayerGame;
  activeYou: string | null;
  activeOpp: string | null;
  autoCollapse?: boolean;
  verbose?: boolean;
  // Manual (unscored) discards, per side. Optional so pre-existing v3 blobs
  // load unchanged. Scored discards live in each game's `log` already.
  discardsYou?: string[];
  discardsOpp?: string[];
  // Persistent per-round primary award ticks, per side. Optional like the
  // discards. A pre-existing blob loads with no ticks but keeps its stored
  // round primaries (the grid stays authoritative; re-tick to edit a round).
  primaryTicksYou?: PrimaryTicksByRound;
  primaryTicksOpp?: PrimaryTicksByRound;
  // Terrain card: rotate keystone labels to face each player. Optional so
  // pre-existing blobs load unchanged (defaults ON — it's a table aid).
  keystoneFacing?: boolean;
  // Command Points per side — a plain counter, not rules-enforced (no auto-gain
  // at the command phase, no stratagem deduction). Optional for back-compat.
  cpYou?: number;
  cpOpp?: number;
  // Cloud binding: the doc id this game last saved to (so re-saves overwrite one
  // doc rather than spawning a new one per round) and the editable save name.
  // Optional/null for games that have never touched the cloud.
  cloudDocId?: string | null;
  cloudName?: string | null;
}

/** Short, locale-stable date like "Jun 13" for the auto-name suffix. */
function shortDate(now: Date): string {
  return now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface AutoNameArgs {
  dispYou: ForceDispositionId | null;
  dispOpp: ForceDispositionId | null;
  /** missionFor(you, opp)?.name and missionFor(opp, you)?.name. */
  missionYouName: string | null;
  missionOppName: string | null;
  totalYou: number;
  totalOpp: number;
  round: number;
  /** Injected so the generator stays pure/testable. */
  now: Date;
}

/**
 * The intelligent default save name, combining (when available) the disposition
 * matchup, both primary mission names, the live scoreline + battle round, and
 * the date. Degrades gracefully before a matchup is picked. Stays well under the
 * worker's 200-char name cap.
 */
export function autoSaveName(args: AutoNameArgs): string {
  const { dispYou, dispOpp, missionYouName, missionOppName, totalYou, totalOpp, round, now } = args;
  const date = shortDate(now);
  if (!dispYou || !dispOpp) {
    return `Mission Matrix game · ${date}`;
  }
  const matchup = `${DISPOSITION_LABELS[dispYou]} vs ${DISPOSITION_LABELS[dispOpp]}`;
  const missions =
    missionYouName && missionOppName ? ` — ${missionYouName}/${missionOppName}` : "";
  const score = ` · ${totalYou}–${totalOpp} (BR${round})`;
  return `${matchup}${missions}${score} · ${date}`;
}

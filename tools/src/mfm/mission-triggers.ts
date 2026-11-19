/**
 * mission-triggers.ts — compare the hand-authored award triggers and award forms in
 * `data/core/mission-cards.json` against the MFM dump's structured scoring metadata.
 *
 * The dump states, per scoring row:
 *   - `primary_mission_objective_scorable_period.scorablePeriod` (primary missions): the
 *     battle rounds in which the row's objective scores — `firstBattleRound` …
 *     `fifthBattleRound` — or `endOfBattle`. An award scores in the rounds its trigger's
 *     `battle_round` window covers (absent bounds are 1 and 5); an `end-of-battle` award
 *     scores only at `endOfBattle`.
 *   - `secondary_mission.isScorableFirstTurn` (secondary missions; their own
 *     scorable-period table is empty): false means the card cannot score in the first
 *     battle round, so every award's `battle_round.min` is at least 2; true means the
 *     awards' windows include round 1.
 *   - `primary_mission_objective.localisations.en.whenText` (primary missions): the only place
 *     the dump states that an objective scored at the end of your Command phase is instead
 *     scored at the end of your turn in the fifth battle round; `scorablePeriod` lists the round
 *     either way. A `whenText` naming both the end of your turn and the fifth battle round means
 *     the award's trigger carries `final_round_timing: end-of-turn`; any other text means it
 *     carries none. The text is read at check time and never stored.
 *   - `*_mission_objective_scoring.inputType`: `checkbox` is a yes/no criterion, scored as
 *     a flat `vp`; `stepper` counts instances, scored as `vp_per` with a `per` descriptor.
 *
 * Rows align to awards the way the `missions` pass aligns them: per scoring track (mode),
 * in objective then row display order. A card whose award count differs from its row
 * count in any track is reported as a shape mismatch and not compared further.
 *
 * The check reads only; it never writes data.
 */
import { nameToId } from "../converters/id-generator.js";
import type { MfmDump } from "./loader.js";
import type { AwardMode } from "./missions.js";

const ROUND_PERIODS = ["firstBattleRound", "secondBattleRound", "thirdBattleRound", "fourthBattleRound", "fifthBattleRound"] as const;
export type ScorablePeriod = (typeof ROUND_PERIODS)[number] | "endOfBattle";
export type InputType = "checkbox" | "stepper";
export type FinalRoundTiming = "end-of-turn";

/**
 * Dump scoring rows whose `inputType` disagrees with the criterion it labels, keyed by the
 * `*_mission_objective_scoring` id. The authored award form stands for these rows.
 */
export const ACCEPTED_INPUT_TYPE: Readonly<Record<string, string>> = {
  // Surveil the Foe, second objective: both rows are stepper, but each criterion is a single
  // yes/no condition (control a non-home objective; control more objectives), scored once.
  "6bbc2cab-b1dd-4883-b0fd-b4ca3c175115": "single yes/no criterion labelled stepper",
  "a54af573-f4ae-45f4-a2ef-363cf7c0f0d4": "single yes/no criterion labelled stepper",
};

/** One dump scoring row with the metadata this check compares. */
export interface TriggerRow {
  scoringId: string;
  mode: AwardMode;
  inputType: InputType | null;
  /** Primary rows: the objective's scorable periods. Null for secondary rows. */
  periods: ScorablePeriod[] | null;
  /** Secondary rows: the mission's isScorableFirstTurn. Null for primary rows. */
  scorableFirstTurn: boolean | null;
  /**
   * Primary rows: the objective's fifth-battle-round timing when it differs from its usual
   * timing, else "none". Undefined for secondary rows, which the dump gives no timing text.
   */
  finalRoundTiming?: FinalRoundTiming | "none";
}

interface Trigger {
  timing?: string;
  battle_round?: { min?: number; max?: number };
  final_round_timing?: string;
}
export interface TriggerAward {
  trigger: Trigger;
  vp?: number;
  vp_per?: number;
  mode?: "fixed" | "tactical";
}
export interface TriggerCard {
  id: string;
  awards?: TriggerAward[];
}

export interface TriggerDisagreement {
  cardId: string;
  /** Index into the card's `awards`. */
  index: number;
  field: "scorable-period" | "first-turn" | "final-round-timing" | "input-type";
  repo: string;
  dump: string;
  scoringId: string;
}

export interface TriggerShapeMismatch {
  cardId: string;
  mode: string;
  repo: number;
  dump: number;
}

export interface TriggerReport {
  matched: number;
  disagreements: TriggerDisagreement[];
  shapeMismatches: TriggerShapeMismatch[];
  /** Dump missions with no repo card. */
  unmatched: string[];
}

const byDisplayOrder = (a: { displayOrder?: number }, b: { displayOrder?: number }): number =>
  (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
const modeKey = (m: AwardMode): string => m ?? "none";

function modeOf(scoringType: string | null | undefined): AwardMode {
  return scoringType === "fixed" || scoringType === "tactical" ? scoringType : undefined;
}

function inputTypeOf(value: unknown): InputType | null {
  return value === "checkbox" || value === "stepper" ? value : null;
}

/** The fifth-battle-round timing an objective's `whenText` states, or "none". */
export function finalRoundTimingOf(whenText: unknown): FinalRoundTiming | "none" {
  if (typeof whenText !== "string") return "none";
  return /\bfifth battle round\b/i.test(whenText) && /\bend of your turn\b/i.test(whenText) ? "end-of-turn" : "none";
}

/** Repo card-id → its dump scoring rows (secondary missions and the generic primary missions). */
export function buildTriggerCanon(dump: MfmDump): Map<string, TriggerRow[]> {
  const out = new Map<string, TriggerRow[]>();
  const idOf = (mission: Parameters<MfmDump["enName"]>[0]): string | null => {
    const name = dump.enName(mission);
    if (!name) return null;
    try {
      return nameToId(name);
    } catch {
      return null;
    }
  };

  const secObjectives = dump.groupBy("secondary_mission_objective", "secondaryMissionId");
  const secScoring = dump.groupBy("secondary_mission_objective_scoring", "secondaryMissionObjectiveId");
  for (const mission of dump.table("secondary_mission")) {
    const id = idOf(mission);
    if (!id) continue;
    const rows: TriggerRow[] = [];
    for (const objective of [...(secObjectives.get(mission.id) ?? [])].sort(byDisplayOrder)) {
      for (const score of [...(secScoring.get(objective.id) ?? [])].sort(byDisplayOrder)) {
        rows.push({
          scoringId: score.id,
          mode: modeOf(score.scoringType),
          inputType: inputTypeOf(score.inputType),
          periods: null,
          scorableFirstTurn: typeof mission.isScorableFirstTurn === "boolean" ? mission.isScorableFirstTurn : null,
        });
      }
    }
    if (rows.length) out.set(id, rows);
  }

  const priObjectives = dump.groupBy("primary_mission_objective", "primaryMissionId");
  const priScoring = dump.groupBy("primary_mission_objective_scoring", "primaryMissionObjectiveId");
  const periods = new Map<string, ScorablePeriod[]>();
  for (const row of dump.table("primary_mission_objective_scorable_period")) {
    const list = periods.get(row.primaryMissionObjectiveId) ?? periods.set(row.primaryMissionObjectiveId, []).get(row.primaryMissionObjectiveId)!;
    list.push(row.scorablePeriod as ScorablePeriod);
  }
  for (const mission of dump.table("primary_mission")) {
    // Detachment-scoped primaries are Combat Patrol reskins the repo does not carry.
    if (mission.detachmentId) continue;
    const id = idOf(mission);
    if (!id) continue;
    const rows: TriggerRow[] = [];
    for (const objective of [...(priObjectives.get(mission.id) ?? [])].sort(byDisplayOrder)) {
      const objectivePeriods = periods.get(objective.id) ?? [];
      const finalRoundTiming = finalRoundTimingOf(objective.localisations?.en?.whenText);
      for (const score of [...(priScoring.get(objective.id) ?? [])].sort(byDisplayOrder)) {
        rows.push({
          scoringId: score.id,
          mode: undefined,
          inputType: inputTypeOf(score.inputType),
          periods: objectivePeriods,
          scorableFirstTurn: null,
          finalRoundTiming,
        });
      }
    }
    if (rows.length) out.set(id, rows);
  }
  return out;
}

/** The periods an award's trigger scores in, in canonical order. */
export function triggerPeriods(trigger: Trigger): ScorablePeriod[] {
  if (trigger.timing === "end-of-battle") return ["endOfBattle"];
  const min = trigger.battle_round?.min ?? 1;
  const max = trigger.battle_round?.max ?? 5;
  return ROUND_PERIODS.filter((_, i) => i + 1 >= min && i + 1 <= max);
}

function canonicalPeriods(periods: readonly ScorablePeriod[]): ScorablePeriod[] {
  const order: readonly ScorablePeriod[] = [...ROUND_PERIODS, "endOfBattle"];
  return order.filter((p) => periods.includes(p));
}

/**
 * Compare one card's awards against its dump rows. Returns the disagreements, or the
 * per-track count mismatch when the rows cannot be aligned.
 */
export function checkCardTriggers(
  card: TriggerCard,
  rows: readonly TriggerRow[],
  accepted: Readonly<Record<string, string>> = ACCEPTED_INPUT_TYPE,
): { disagreements: TriggerDisagreement[]; shapeMismatches: TriggerShapeMismatch[] } {
  const awards = card.awards ?? [];
  const awardsByMode = new Map<string, { award: TriggerAward; index: number }[]>();
  awards.forEach((award, index) => {
    const key = modeKey(award.mode);
    (awardsByMode.get(key) ?? awardsByMode.set(key, []).get(key)!).push({ award, index });
  });
  const rowsByMode = new Map<string, TriggerRow[]>();
  for (const row of rows) {
    const key = modeKey(row.mode);
    (rowsByMode.get(key) ?? rowsByMode.set(key, []).get(key)!).push(row);
  }
  const shapeMismatches: TriggerShapeMismatch[] = [];
  for (const mode of [...new Set([...awardsByMode.keys(), ...rowsByMode.keys()])].sort()) {
    const repo = awardsByMode.get(mode)?.length ?? 0;
    const dumpCount = rowsByMode.get(mode)?.length ?? 0;
    if (repo !== dumpCount) shapeMismatches.push({ cardId: card.id, mode, repo, dump: dumpCount });
  }
  if (shapeMismatches.length) return { disagreements: [], shapeMismatches };

  const disagreements: TriggerDisagreement[] = [];
  for (const [mode, list] of awardsByMode) {
    const modeRows = rowsByMode.get(mode)!;
    list.forEach(({ award, index }, i) => {
      const row = modeRows[i]!;
      const push = (field: TriggerDisagreement["field"], repo: string, dumpValue: string) =>
        disagreements.push({ cardId: card.id, index, field, repo, dump: dumpValue, scoringId: row.scoringId });
      const scored = triggerPeriods(award.trigger ?? {});

      if (row.periods) {
        const expected = canonicalPeriods(row.periods);
        if (scored.join() !== expected.join()) push("scorable-period", scored.join(","), expected.join(","));
      }
      if (row.finalRoundTiming !== undefined) {
        const authored = award.trigger?.final_round_timing ?? "none";
        if (authored !== row.finalRoundTiming) push("final-round-timing", authored, row.finalRoundTiming);
      }
      if (row.scorableFirstTurn != null) {
        const scoresFirst = scored.includes("firstBattleRound");
        if (scoresFirst !== row.scorableFirstTurn) {
          push("first-turn", scoresFirst ? "scores in round 1" : "not before round 2", `isScorableFirstTurn=${row.scorableFirstTurn}`);
        }
      }
      if (row.inputType && !(row.scoringId in accepted)) {
        const form = award.vp_per != null ? "stepper" : "checkbox";
        if (form !== row.inputType) push("input-type", award.vp_per != null ? "vp_per" : "vp", row.inputType);
      }
    });
  }
  disagreements.sort((a, b) => a.index - b.index || a.field.localeCompare(b.field));
  return { disagreements, shapeMismatches };
}

/** Check every repo mission card that has dump scoring rows. */
export function missionTriggerDrift(dump: MfmDump, cards: readonly TriggerCard[]): TriggerReport {
  const canon = buildTriggerCanon(dump);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const report: TriggerReport = { matched: 0, disagreements: [], shapeMismatches: [], unmatched: [] };
  for (const [id, rows] of [...canon].sort(([a], [b]) => a.localeCompare(b))) {
    const card = byId.get(id);
    if (!card) {
      report.unmatched.push(id);
      continue;
    }
    report.matched++;
    const result = checkCardTriggers(card, rows);
    report.disagreements.push(...result.disagreements);
    report.shapeMismatches.push(...result.shapeMismatches);
  }
  return report;
}

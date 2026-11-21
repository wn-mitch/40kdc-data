import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, loadDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import {
  buildTriggerCanon,
  checkCardTriggers,
  finalRoundTimingOf,
  missionTriggerDrift,
  triggerPeriods,
  type TriggerCard,
  type TriggerRow,
} from "../src/mfm/mission-triggers.js";
import { partialDump } from "./mfm-fixture.js";

const ALL_ROUNDS = ["firstBattleRound", "secondBattleRound", "thirdBattleRound", "fourthBattleRound", "fifthBattleRound"] as const;

/** A primary mission with one any-round checkbox objective and one end-of-battle stepper objective,
 *  and a secondary mission that cannot score in the first battle round. */
function fixture() {
  return partialDump({
    data: {
      primary_mission: [
        { id: "pm", detachmentId: null, localisations: { en: { name: "Fabricated Primary" } } },
        { id: "pm-cp", detachmentId: "det", localisations: { en: { name: "Fabricated Patrol Primary" } } },
      ],
      primary_mission_objective: [
        { id: "o2", primaryMissionId: "pm", displayOrder: 2 },
        {
          id: "o1",
          primaryMissionId: "pm",
          displayOrder: 1,
          localisations: { en: { whenText: "Fabricated phase end; in the fifth battle round, the end of your turn instead." } },
        },
        { id: "o-cp", primaryMissionId: "pm-cp", displayOrder: 1 },
      ],
      primary_mission_objective_scoring: [
        { id: "s1", primaryMissionObjectiveId: "o1", displayOrder: 0, inputType: "checkbox", victoryPoints: 3 },
        { id: "s2", primaryMissionObjectiveId: "o2", displayOrder: 0, inputType: "stepper", victoryPoints: 2 },
        { id: "s-cp", primaryMissionObjectiveId: "o-cp", displayOrder: 0, inputType: "checkbox", victoryPoints: 2 },
      ],
      primary_mission_objective_scorable_period: [
        ...ALL_ROUNDS.slice(1).map((scorablePeriod) => ({ primaryMissionObjectiveId: "o1", scorablePeriod })),
        { primaryMissionObjectiveId: "o2", scorablePeriod: "endOfBattle" },
      ],
      secondary_mission: [{ id: "sm", isScorableFirstTurn: false, localisations: { en: { name: "Fabricated Secondary" } } }],
      secondary_mission_objective: [{ id: "so", secondaryMissionId: "sm", displayOrder: 1 }],
      secondary_mission_objective_scoring: [
        { id: "ss-fixed", secondaryMissionObjectiveId: "so", displayOrder: 1, scoringType: "fixed", inputType: "stepper", victoryPoints: 2 },
        { id: "ss-tactical", secondaryMissionObjectiveId: "so", displayOrder: 2, scoringType: "tactical", inputType: "checkbox", victoryPoints: 5 },
      ],
    },
  });
}

describe("triggerPeriods", () => {
  it("covers rounds 1-5 when the window is open and only the end of the battle for end-of-battle", () => {
    expect(triggerPeriods({ timing: "end-of-turn" })).toEqual([...ALL_ROUNDS]);
    expect(triggerPeriods({ timing: "end-of-phase", battle_round: { min: 2, max: 3 } })).toEqual(["secondBattleRound", "thirdBattleRound"]);
    expect(triggerPeriods({ timing: "end-of-turn", battle_round: { max: 1 } })).toEqual(["firstBattleRound"]);
    expect(triggerPeriods({ timing: "end-of-battle" })).toEqual(["endOfBattle"]);
  });
});

describe("buildTriggerCanon (synthetic)", () => {
  const canon = buildTriggerCanon(fixture());

  it("orders a primary's rows by objective display order and carries each objective's periods", () => {
    const rows = canon.get("fabricated-primary")!;
    expect(rows.map((r) => r.scoringId)).toEqual(["s1", "s2"]);
    expect(rows[0]!.periods).toEqual(ALL_ROUNDS.slice(1));
    expect(rows[1]!.periods).toEqual(["endOfBattle"]);
    expect(rows[0]!.inputType).toBe("checkbox");
    expect(rows.map((r) => r.finalRoundTiming)).toEqual(["end-of-turn", "none"]);
  });

  it("skips detachment-scoped primaries and carries a secondary's first-turn flag and tracks", () => {
    expect(canon.has("fabricated-patrol-primary")).toBe(false);
    const rows = canon.get("fabricated-secondary")!;
    expect(rows.map((r) => [r.mode, r.scorableFirstTurn, r.periods])).toEqual([["fixed", false, null], ["tactical", false, null]]);
    expect(rows.map((r) => r.finalRoundTiming)).toEqual([undefined, undefined]);
  });
});

describe("finalRoundTimingOf", () => {
  it("reads end-of-turn only from text naming both the end of your turn and the fifth battle round", () => {
    expect(finalRoundTimingOf("Phase end, or the end of your turn in the fifth battle round.")).toBe("end-of-turn");
    expect(finalRoundTimingOf("End of your turn.")).toBe("none");
    expect(finalRoundTimingOf("Something in the fifth battle round.")).toBe("none");
    expect(finalRoundTimingOf(undefined)).toBe("none");
  });
});

describe("checkCardTriggers", () => {
  const canon = buildTriggerCanon(fixture());
  const primary = (awards: TriggerCard["awards"]): TriggerCard => ({ id: "fabricated-primary", awards });

  it("accepts awards whose rounds, end-of-battle timing and form match the dump", () => {
    const card = primary([
      { trigger: { timing: "end-of-phase", battle_round: { min: 2 }, final_round_timing: "end-of-turn" }, vp: 3 },
      { trigger: { timing: "end-of-battle" }, vp_per: 2 },
    ]);
    expect(checkCardTriggers(card, canon.get(card.id)!)).toEqual({ disagreements: [], shapeMismatches: [] });
  });

  it("flags a fifth-round timing the award lacks, and one the dump does not state", () => {
    const missing = primary([
      { trigger: { timing: "end-of-phase", battle_round: { min: 2 } }, vp: 3 },
      { trigger: { timing: "end-of-battle" }, vp_per: 2 },
    ]);
    expect(checkCardTriggers(missing, canon.get(missing.id)!).disagreements.map((d) => [d.index, d.field, d.repo, d.dump])).toEqual([
      [0, "final-round-timing", "none", "end-of-turn"],
    ]);
    const extra = primary([
      { trigger: { timing: "end-of-phase", battle_round: { min: 2 }, final_round_timing: "end-of-turn" }, vp: 3 },
      { trigger: { timing: "end-of-battle", final_round_timing: "end-of-turn" }, vp_per: 2 },
    ]);
    expect(checkCardTriggers(extra, canon.get(extra.id)!).disagreements.map((d) => [d.index, d.field, d.repo, d.dump])).toEqual([
      [1, "final-round-timing", "end-of-turn", "none"],
    ]);
  });

  it("flags an award that scores in a round the dump does not list", () => {
    const card = primary([
      { trigger: { timing: "end-of-turn", final_round_timing: "end-of-turn" }, vp: 3 },
      { trigger: { timing: "end-of-battle" }, vp_per: 2 },
    ]);
    const { disagreements } = checkCardTriggers(card, canon.get(card.id)!);
    expect(disagreements).toEqual([
      expect.objectContaining({ index: 0, field: "scorable-period", dump: ALL_ROUNDS.slice(1).join(","), scoringId: "s1" }),
    ]);
  });

  it("flags an end-of-battle objective authored as a per-round award", () => {
    const card = primary([
      { trigger: { timing: "end-of-phase", battle_round: { min: 2 }, final_round_timing: "end-of-turn" }, vp: 3 },
      { trigger: { timing: "end-of-turn", battle_round: { min: 5 } }, vp_per: 2 },
    ]);
    const { disagreements } = checkCardTriggers(card, canon.get(card.id)!);
    expect(disagreements.map((d) => [d.index, d.field, d.repo, d.dump])).toEqual([[1, "scorable-period", "fifthBattleRound", "endOfBattle"]]);
  });

  it("flags a checkbox row authored as vp_per and a stepper row authored as flat vp", () => {
    const card = primary([
      { trigger: { timing: "end-of-phase", battle_round: { min: 2 }, final_round_timing: "end-of-turn" }, vp_per: 3 },
      { trigger: { timing: "end-of-battle" }, vp: 2 },
    ]);
    const { disagreements } = checkCardTriggers(card, canon.get(card.id)!);
    expect(disagreements.map((d) => [d.index, d.field, d.repo, d.dump])).toEqual([
      [0, "input-type", "vp_per", "checkbox"],
      [1, "input-type", "vp", "stepper"],
    ]);
    // A row on the accepted list keeps the authored form.
    expect(checkCardTriggers(card, canon.get(card.id)!, { s1: "fixture", s2: "fixture" }).disagreements).toEqual([]);
  });

  it("aligns secondary awards per track and flags one that scores in the first battle round", () => {
    const rows = canon.get("fabricated-secondary")!;
    const ok: TriggerCard = {
      id: "fabricated-secondary",
      awards: [
        { trigger: { timing: "end-of-turn", battle_round: { min: 2 } }, vp: 5, mode: "tactical" },
        { trigger: { timing: "end-of-turn", battle_round: { min: 2 } }, vp_per: 2, mode: "fixed" },
      ],
    };
    expect(checkCardTriggers(ok, rows).disagreements).toEqual([]);
    const early: TriggerCard = { ...ok, awards: [ok.awards![0]!, { ...ok.awards![1]!, trigger: { timing: "end-of-turn" } }] };
    expect(checkCardTriggers(early, rows).disagreements.map((d) => [d.index, d.field])).toEqual([[1, "first-turn"]]);
  });

  it("reports a track whose award count differs from the dump instead of comparing it", () => {
    const rows: TriggerRow[] = canon.get("fabricated-secondary")!;
    const card: TriggerCard = { id: "fabricated-secondary", awards: [{ trigger: { timing: "end-of-turn", battle_round: { min: 2 } }, vp: 5 }] };
    const result = checkCardTriggers(card, rows);
    expect(result.disagreements).toEqual([]);
    expect(result.shapeMismatches.map((m) => [m.mode, m.repo, m.dump])).toEqual([["fixed", 0, 1], ["none", 1, 0], ["tactical", 0, 1]]);
  });
});

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("mission card triggers against the real dump", () => {
  it("every authored award agrees with the dump's scorable periods, first-turn flag and input type", () => {
    const cards = JSON.parse(fs.readFileSync(path.join(CORE_DIR, "mission-cards.json"), "utf8")) as TriggerCard[];
    const report = missionTriggerDrift(loadDump(), cards);
    expect(report.matched).toBe(43);
    expect(report.unmatched).toEqual([]);
    expect(report.shapeMismatches).toEqual([]);
    expect(report.disagreements).toEqual([]);
  });
});

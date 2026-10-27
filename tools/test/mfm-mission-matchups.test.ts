import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import { DEFAULT_DUMP_PATH, loadDump, MfmDump } from "../src/mfm/loader.js";
import { buildMatchupCanon, runMissionMatchups } from "../src/mfm/mission-matchups.js";
import { partialDump } from "./mfm-fixture.js";

/**
 * WS5 mission-matchup reconcile. The canon derivation (force_disposition_mission
 * → id + disposition slugs + mission_id) is unit-tested with synthetic fixtures;
 * the whole-repo reconcile is dump-guarded. The load-bearing end-state: the 25
 * authored matchups already equal the dump, so the pass is idempotent
 * (confirm-only) — it exists to re-derive them if a future dataslate re-pairs
 * dispositions, not to churn the file.
 */

function fixture(): MfmDump {
  return partialDump({
    data: {
      force_disposition: [
        { id: "fd-th", localisations: { en: { name: "Take and Hold" } } },
        { id: "fd-dis", localisations: { en: { name: "Disruption" } } },
      ],
      primary_mission: [
        { id: "pm-1", localisations: { en: { name: "Battlefield Dominance" } } },
        { id: "pm-2", localisations: { en: { name: "Scorched Earth" } } },
      ],
      force_disposition_mission: [
        { id: "x1", friendlyForceDispositionId: "fd-th", oppositionForceDispositionId: "fd-th", primaryMissionId: "pm-1" },
        { id: "x2", friendlyForceDispositionId: "fd-th", oppositionForceDispositionId: "fd-dis", primaryMissionId: "pm-2" },
      ],
    },
  });
}

describe("mission-matchup canon derivation (synthetic)", () => {
  const canon = buildMatchupCanon(fixture());

  it("keys a matchup by '<disposition>-vs-<opponent>' and resolves both slugs", () => {
    const mirror = canon.get("take-and-hold-vs-take-and-hold");
    expect(mirror).toEqual({
      disposition: "take-and-hold",
      opponent_disposition: "take-and-hold",
      mission_id: "battlefield-dominance",
    });
  });

  it("derives the asymmetric pairing and its mission", () => {
    const asym = canon.get("take-and-hold-vs-disruption");
    expect(asym).toEqual({
      disposition: "take-and-hold",
      opponent_disposition: "disruption",
      mission_id: "scorched-earth",
    });
  });

  it("collects an unresolvable dump row rather than emitting a partial record", () => {
    const dump = partialDump({
      data: {
        force_disposition: [{ id: "fd-th", localisations: { en: { name: "Take and Hold" } } }],
        primary_mission: [{ id: "pm-1", localisations: { en: { name: "Battlefield Dominance" } } }],
        force_disposition_mission: [
          { id: "bad", friendlyForceDispositionId: "fd-missing", oppositionForceDispositionId: "fd-th", primaryMissionId: "pm-1" },
        ],
      },
    });
    const unresolved: string[] = [];
    const canon2 = buildMatchupCanon(dump, unresolved);
    expect(canon2.size).toBe(0);
    expect(unresolved).toContain("bad");
  });
});

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("mission-matchup reconcile over the real dump", () => {
  // Load the dump lazily in beforeAll — never in the describe body, which Vitest
  // executes at collection time regardless of skipIf, before the guard applies.
  let report: ReturnType<typeof runMissionMatchups>;
  beforeAll(() => {
    report = runMissionMatchups(loadDump());
  });

  it("matches all 25 authored matchups with no drift (idempotent confirm-only)", () => {
    expect(report.matched).toBe(25);
    expect(report.seeded).toEqual([]);
    expect(report.corrected).toEqual([]);
    expect(report.repoOnly).toEqual([]);
    expect(report.unresolvedDump).toEqual([]);
  });

  it("stages nothing when the data already matches the dump", () => {
    expect(report.staged).toEqual([]);
  });

  it("derives every dump pairing (the 5x5 disposition matrix)", () => {
    const canon = buildMatchupCanon(loadDump());
    expect(canon.size).toBe(25);
    expect(canon.has("take-and-hold-vs-take-and-hold")).toBe(true);
  });
});

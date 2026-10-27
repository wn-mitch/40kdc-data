import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { DamageCellCache } from "../src/stack-damage/cache.js";
import { DEFAULT_HC_FACTIONS, parseMatrixConfig, parseScenario } from "../src/stack-damage/config.js";
import { factionLineageFrom, preferFactionCopies, resolveFactionContext, unitAllowedInFaction } from "../src/stack-damage/factions.js";
import {
  DAMAGE_MATRIX_FORMAT,
  damageCellKey,
  matrixScope,
  readResumableCells,
  reportCompleteness,
  sourceFingerprint,
  type DamageCellReport,
} from "../src/stack-damage/report.js";
import { damageScoringSession, emptySpec, runDamageCell } from "../src/stack-damage/search.js";
import type { Unit } from "../src/generated.js";

const catalog = {
  factionIds: new Set([...DEFAULT_HC_FACTIONS, "parent", "child"]),
  targetIds: ["light", "heavy"],
};

describe("stack damage matrix configuration", () => {
  it("defaults to the confirmed four factions and the full target/phase cross product without truncation", () => {
    const config = parseMatrixConfig({}, catalog, "/work");
    expect(config.factionIds).toEqual(DEFAULT_HC_FACTIONS);
    expect(config.targetIds).toEqual(["light", "heavy"]);
    expect(config.phases).toEqual(["shooting", "fight"]);
    expect(config.bodyguardLimit).toBe(Infinity);
    expect(config.attachmentLimit).toBe(Infinity);
    expect(config.finalistLimit).toBe(Infinity);
  });

  it("rejects unknown ids and ambiguous all-target requests before search", () => {
    expect(() => parseMatrixConfig({ HC_FACTIONS: "missing" }, catalog)).toThrow("unknown faction");
    expect(() => parseMatrixConfig({ HC_TARGETS: "all,light" }, catalog)).toThrow("cannot be combined");
    expect(() => parseMatrixConfig({ HC_PHASES: "psychic" }, catalog)).toThrow("unsupported phase");
    expect(() => parseMatrixConfig({ HC_OUTPUT: "matrix.txt" }, catalog)).toThrow(".json");
  });
});

describe("stack damage matrix resume", () => {
  const config = parseMatrixConfig({}, catalog, "/work");
  const cell = { key: damageCellKey("tau-empire", "light", "shooting") } as DamageCellReport;
  const report = (scope: string) => {
    const path = join(mkdtempSync(join(tmpdir(), "matrix-resume-")), "matrix.json");
    writeFileSync(path, JSON.stringify({ format: DAMAGE_MATRIX_FORMAT, scope, cells: [cell] }));
    return path;
  };

  it("resumes only a report written by the same config, scenario, code and data", () => {
    const scope = matrixScope(config, "source-a");
    expect(readResumableCells(report(scope), scope)).toEqual({ cells: [cell], discarded: null });
    for (const stale of [
      matrixScope(config, "source-b"),
      matrixScope({ ...config, scenario: { battleRound: 2 } }, "source-a"),
      matrixScope({ ...config, phases: ["fight"] }, "source-a"),
    ]) {
      expect(readResumableCells(report(stale), scope)).toEqual({ cells: [], discarded: expect.stringContaining("differ") });
    }
    expect(readResumableCells("/nonexistent/matrix.json", scope)).toEqual({ cells: [], discarded: null });
  });

  it("fingerprints file content and names", () => {
    const tree = (files: Record<string, string>) => {
      const root = mkdtempSync(join(tmpdir(), "matrix-source-"));
      for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
      return sourceFingerprint(root);
    };
    const base = tree({ "a.ts": "one", "b.ts": "two" });
    expect(tree({ "b.ts": "two", "a.ts": "one" })).toBe(base);
    expect(tree({ "a.ts": "one", "b.ts": "three" })).not.toBe(base);
    expect(tree({ "a.ts": "one", "c.ts": "two" })).not.toBe(base);
    // Moving bytes across the file boundary must not collide.
    expect(tree({ "a.ts": "onet", "b.ts": "wo" })).not.toBe(base);
  });
});

describe("stack damage scenario", () => {
  it("rejects undeclared fields and malformed values", () => {
    expect(parseScenario({ battleRound: 2, targetDesignations: ["spotted"], attackerObjectives: [{ controller: "attacker" }] }))
      .toEqual({ battleRound: 2, targetDesignations: ["spotted"], attackerObjectives: [{ controller: "attacker" }] });
    expect(() => parseScenario({ phase: "fight" })).toThrow("unknown field phase");
    expect(() => parseScenario({ battleRound: 0 })).toThrow("battleRound is malformed");
    expect(() => parseScenario({ targetStates: ["embarked"] })).toThrow("targetStates is malformed");
    expect(() => parseScenario({ attackerObjectives: [{ controller: "friendly" }] })).toThrow("attackerObjectives is malformed");
    expect(() => parseScenario([])).toThrow("must be a JSON object");
    const neighbour = { keywords: ["BATTLELINE"], owner: "friendly", distanceInches: 3 };
    expect(parseScenario({ attackerNeighbours: [neighbour] })).toEqual({ attackerNeighbours: [neighbour] });
    expect(() => parseScenario({ attackerNeighbours: [{ ...neighbour, owner: "attacker" }] })).toThrow("attackerNeighbours is malformed");
    expect(() => parseScenario({ targetNeighbours: [{ ...neighbour, distanceInches: -1 }] })).toThrow("targetNeighbours is malformed");
    const declared = {
      activeRules: ["example-rule", { ability_id: "example-doctrines", option_id: "assault" }],
      attackerRegions: [{ ruleRegion: "flow-of-magic" }, { terrainArea: true, wholly: true }],
      objectivesControlled: { attacker: 2, target: 1, total: 5 },
    };
    expect(parseScenario(declared)).toEqual(declared);
    expect(() => parseScenario({ attackerRegions: [{ terrainArea: true, territory: "attacker" }] })).toThrow("attackerRegions is malformed");
    expect(() => parseScenario({ objectivesControlled: { attacker: 4, target: 3, total: 5 } })).toThrow("objectivesControlled is malformed");
    expect(() => parseScenario({ activeRules: [{ option_id: "assault" }] })).toThrow("activeRules is malformed");
  });

  it("states the crunch's own facts and lets the scenario declare the rest", () => {
    const dataset = Dataset.embedded();
    const faction = resolveFactionContext(dataset, "chaos-space-marines");
    const target = resolveTarget(dataset, dataset.targetProfiles.get("meq-intercessors")!)!;
    const config = parseMatrixConfig({ HC_FACTIONS: "chaos-space-marines", HC_TARGETS: "meq-intercessors" }, {
      factionIds: new Set(["chaos-space-marines"]),
      targetIds: ["meq-intercessors"],
    });
    const defiler = faction.units.find((unit) => unit.id === "defiler")!;
    const member = { unit: defiler, role: "bodyguard" as const };
    const context = (scenario: typeof config.scenario) =>
      damageScoringSession({ dataset, config: { ...config, scenario }, faction, target, phase: "shooting" })
        .state.contextFor(emptySpec(faction.id, [member]), member);
    const W = defiler.raw.profiles[0]!.W;
    expect(context({})).toMatchObject({
      attackerTurn: true,
      attackerStrength: "full",
      targetStrength: "full",
      attackerWounds: { remaining: W, starting: W },
      targetWounds: { remaining: 2, starting: 2 },
    });
    expect(context({}).targetDesignations).toBeUndefined();
    expect(context({ targetStrength: "below-half", targetDesignations: ["focus-of-hatred"] }))
      .toMatchObject({ targetStrength: "below-half", targetDesignations: ["focus-of-hatred"], phase: "shooting" });
  });
});

describe("stack damage faction inheritance", () => {
  it("walks parents, prefers child copies, and enforces faction keyword exclusions", () => {
    const factions = new Map([
      ["child", { id: "child", parent_faction_id: "parent" }],
      ["parent", { id: "parent", parent_faction_id: null }],
    ]);
    expect(factionLineageFrom("child", (id) => factions.get(id))).toEqual(["child", "parent"]);
    expect(preferFactionCopies([
      { id: "shared", faction_id: "parent", marker: "parent" },
      { id: "shared", faction_id: "child", marker: "child" },
      { id: "parent-only", faction_id: "parent", marker: "parent" },
    ], ["child", "parent"]).map((record) => [record.id, record.marker])).toEqual([
      ["shared", "child"],
      ["parent-only", "parent"],
    ]);

    const armyKeywords = new Set(["Imperium", "Child"]);
    const allowed = { faction_keywords: ["Imperium"] } as Unit;
    const foreign = { faction_keywords: ["Imperium", "Other"] } as Unit;
    const excluded = { faction_keywords: ["Imperium"], excluded_faction_keywords: ["Child"] } as Unit;
    expect(unitAllowedInFaction(allowed, armyKeywords)).toBe(true);
    expect(unitAllowedInFaction(foreign, armyKeywords)).toBe(false);
    expect(unitAllowedInFaction(excluded, armyKeywords)).toBe(false);
  });
});

describe("stack damage target-scoped state and output", () => {
  it("cannot reuse a same-shaped cache entry across targets", () => {
    const light = new DamageCellCache<number>("child", "light", "shooting");
    const heavy = new DamageCellCache<number>("child", "heavy", "shooting");
    light.set("same-unit|same-buffs", 12);
    heavy.set("same-unit|same-buffs", 3);
    expect(light.get("same-unit|same-buffs")).toBe(12);
    expect(heavy.get("same-unit|same-buffs")).toBe(3);
    expect([...light.values.keys()]).not.toEqual([...heavy.values.keys()]);
  });

  it("requires exactly one output cell for every configured faction/target/phase", () => {
    const config = {
      factionIds: ["parent", "child"],
      targetIds: ["light", "heavy"],
      phases: ["shooting", "fight"] as const,
    };
    const cell = (factionId: string, targetId: string, phase: "shooting" | "fight") => ({
      key: damageCellKey(factionId, targetId, phase), factionId, phase,
    }) as DamageCellReport;
    const cells = config.factionIds.flatMap((factionId) =>
      config.targetIds.flatMap((targetId) => config.phases.map((phase) => cell(factionId, targetId, phase))),
    );
    expect(reportCompleteness(config, cells)).toEqual({ complete: true, missing: [], unexpected: [], duplicates: [] });
    expect(reportCompleteness(config, [...cells.slice(1), cells[1]])).toMatchObject({ complete: false });
  });
});

describe("stack damage loadout search performance", () => {
  it("preserves the bounded Tau scores and evaluates Broadside Battlesuits without truncation", () => {
    const dataset = Dataset.embedded();
    const faction = resolveFactionContext(dataset, "tau-empire");
    const targetProfile = dataset.targetProfiles.get("geq-guardsmen");
    const target = targetProfile ? resolveTarget(dataset, targetProfile) : null;
    expect(target).not.toBeNull();

    const run = (bodyguardLimit: number) => {
      const config = parseMatrixConfig({
        HC_FACTIONS: "tau-empire",
        HC_TARGETS: "geq-guardsmen",
        HC_PHASES: "shooting",
        HC_BODYGUARDS: String(bodyguardLimit),
        HC_TOP: "1",
        HC_DEEP: "1",
        HC_OUTPUT: "tau-broadside-regression.json",
      }, {
        factionIds: new Set(["tau-empire"]),
        targetIds: ["geq-guardsmen"],
      });
      return runDamageCell({
        dataset,
        config,
        faction,
        target: target!,
        phase: "shooting",
      });
    };

    // The Tiger Shark is not a BATTLESUIT, so The Arro'kon Protocol cannot target it. Guardian
    // Drones penalise only attacks against the bearer's unit, never its own shooting. Experimental
    // Ammunition targets only a BATTLESUIT CHARACTER unit, so it cannot either.
    const tigerShark = run(1).winner;
    expect(tigerShark?.expectedDamage).toBeCloseTo(29.004629629629623, 12);
    expect(tigerShark?.stratagem?.id).not.toBe("the-arrokon-protocol-retaliation-cadre-tau-empire");
    expect(tigerShark?.stratagem?.id).not.toBe("experimental-ammunition-experimental-prototype-cadre-tau-empire");
    expect(run(2).winner?.expectedDamage).toBeCloseTo(29.004629629629623, 12);
    const withBroadside = run(3);
    expect(withBroadside.candidateCounts).toMatchObject({
      bodyguards: 3,
      memberStacks: 4,
      broadResults: 4,
      deepFinalists: 1,
    });
    // Broadsides are BATTLESUITs; Guardsmen (10 models) meet Arro'kon's 6+ band for Sustained Hits 1,
    // and every Broadside model is a BATTLESUIT, so Bonded Heroes' model-level +1 S and AP applies.
    // Each model takes its two Missile Drones, whose pods its drone rule equips.
    expect(withBroadside.winner?.expectedDamage).toBeCloseTo(55.200617283950606, 12);
    expect(withBroadside.winner?.selectedLevers.map((lever) => lever.id)).toContain("detachment:bonded-heroes-tau-empire");
    expect(withBroadside.winner?.stratagem?.id).toBe("the-arrokon-protocol-retaliation-cadre-tau-empire");
    expect(withBroadside.winner?.members[0]).toMatchObject({
      unitId: "broadside-battlesuits",
      modelCount: 3,
      legalityErrors: [],
    });
    // Each reported profile's attribution reconciles with its damage, and the Stratagem shows its lift.
    const weapons = withBroadside.winner!.members.flatMap((member) => member.weapons);
    for (const weapon of weapons) {
      const attribution = weapon.attribution!;
      const lifted = attribution.lifts.reduce((sum, lift) => sum + lift.delta, 0);
      expect(attribution.baseline + lifted + attribution.residual).toBeCloseTo(weapon.stages["after-fnp"], 9);
    }
    const strat = weapons.flatMap((weapon) => weapon.attribution!.lifts)
      .filter((lift) => lift.source.kind === "ability" && lift.source.abilityId.startsWith("the-arrokon-protocol"));
    expect(strat.reduce((sum, lift) => sum + lift.delta, 0)).toBeGreaterThan(0);
  }, 10_000);
});

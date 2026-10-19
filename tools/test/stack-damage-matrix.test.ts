import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { DamageCellCache } from "../src/stack-damage/cache.js";
import { DEFAULT_HC_FACTIONS, parseMatrixConfig } from "../src/stack-damage/config.js";
import { factionLineageFrom, preferFactionCopies, resolveFactionContext, unitAllowedInFaction } from "../src/stack-damage/factions.js";
import { damageCellKey, reportCompleteness, type DamageCellReport } from "../src/stack-damage/report.js";
import { runDamageCell } from "../src/stack-damage/search.js";
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

    expect(run(1).winner?.expectedDamage).toBeCloseTo(31.9753086419753, 12);
    expect(run(2).winner?.expectedDamage).toBeCloseTo(34.04938271604937, 12);
    const withBroadside = run(3);
    expect(withBroadside.candidateCounts).toMatchObject({
      bodyguards: 3,
      memberStacks: 4,
      broadResults: 4,
      deepFinalists: 1,
    });
    expect(withBroadside.winner?.expectedDamage).toBeCloseTo(47.185185185185176, 12);
    expect(withBroadside.winner?.members[0]).toMatchObject({
      unitId: "broadside-battlesuits",
      modelCount: 3,
      legalityErrors: [],
    });
  }, 10_000);
});

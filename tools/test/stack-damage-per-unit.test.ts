import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig, serializableConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import type { StackResult } from "../src/stack-damage/model.js";
import { matrixScope } from "../src/stack-damage/report.js";
import { bestPerUnit, runDamageCell } from "../src/stack-damage/search.js";

const catalog = { factionIds: new Set(["tau-empire"]), targetIds: ["meq-intercessors"] };

/** A fabricated broad result: `host` is the bodyguard, `total` its score. */
function result(host: string, total: number, leader?: string): StackResult {
  const members = [{ unit: { id: host }, role: "bodyguard" }, ...(leader ? [{ unit: { id: leader }, role: "leader" }] : [])];
  return { spec: { members }, total, members: [] } as unknown as StackResult;
}

describe("per-unit configuration", () => {
  it("is off by default, keeping the default config and resume scope free of it", () => {
    const off = parseMatrixConfig({ HC_FACTIONS: "tau-empire" }, catalog, "/work");
    expect(off.perUnitFinalists).toBeNull();
    expect(serializableConfig(off)).not.toHaveProperty("perUnitFinalists");
    expect(matrixScope(off, "fp")).not.toContain("perUnitFinalists");
  });

  it("takes a positive integer and keeps per-unit reports from resuming as default ones", () => {
    const on = parseMatrixConfig({ HC_FACTIONS: "tau-empire", HC_PER_UNIT: "2" }, catalog, "/work");
    expect(on.perUnitFinalists).toBe(2);
    expect(serializableConfig(on)).toMatchObject({ perUnitFinalists: 2 });
    expect(matrixScope(on, "fp")).not.toBe(matrixScope(parseMatrixConfig({ HC_FACTIONS: "tau-empire" }, catalog, "/work"), "fp"));
    expect(() => parseMatrixConfig({ HC_FACTIONS: "tau-empire", HC_PER_UNIT: "0" }, catalog)).toThrow("HC_PER_UNIT");
    expect(() => parseMatrixConfig({ HC_FACTIONS: "tau-empire", HC_PER_UNIT: "yes" }, catalog)).toThrow("HC_PER_UNIT");
  });
});

describe("bestPerUnit", () => {
  it("deepens only each unit's top broad results and keeps the unit's deep best, units best first", () => {
    // Sorted best first, as runDamageCell passes them.
    const broad = [result("a", 10, "x"), result("b", 9), result("a", 8), result("a", 7, "y"), result("b", 1, "x")];
    // Deep search reverses a's broad order: its second stack ends best.
    const deepTotals = new Map<StackResult, number>([[broad[0], 11], [broad[1], 9.5], [broad[2], 12], [broad[3], 50], [broad[4], 20]]);
    const deepened: StackResult[] = [];
    const deepen = (stack: StackResult) => {
      deepened.push(stack);
      return { ...stack, total: deepTotals.get(stack)! };
    };
    const units = bestPerUnit(broad, 2, deepen);
    // a's third stack (deep 50) and b's second (deep 20) fall outside the per-unit limit of 2.
    expect(deepened).toEqual([broad[0], broad[2], broad[1], broad[4]]);
    expect(units.map(({ stack, deepFinalists }) => [stack.spec.members[0].unit.id, stack.total, deepFinalists])).toEqual([
      ["b", 20, 2],
      ["a", 12, 2],
    ]);
  });
});

describe("per-unit damage cell", () => {
  it("reports each bodyguard's deep best without changing the cell's own result", () => {
    const dataset = Dataset.embedded();
    const faction = resolveFactionContext(dataset, "tau-empire");
    const target = resolveTarget(dataset, dataset.targetProfiles.get("meq-intercessors")!)!;
    const run = (env: Record<string, string>) => runDamageCell({
      dataset,
      config: parseMatrixConfig({ HC_FACTIONS: "tau-empire", HC_TARGETS: "meq-intercessors", HC_PHASES: "shooting", HC_BODYGUARDS: "3", HC_TOP: "1", HC_DEEP: "1", ...env }, catalog),
      faction,
      target,
      phase: "shooting",
    });
    const strip = ({ runtimeMs: _runtime, evaluations: _evaluations, units: _units, ...cell }: ReturnType<typeof run>) => cell;
    const plain = run({});
    const perUnit = run({ HC_PER_UNIT: "1" });
    expect(plain).not.toHaveProperty("units");
    expect(strip(perUnit)).toEqual(strip(plain));

    const units = perUnit.units!;
    expect(units).toHaveLength(plain.candidateCounts.bodyguards);
    expect(new Set(units.map((unit) => unit.unitId)).size).toBe(units.length);
    for (const unit of units) expect(unit.winner.members[0]).toMatchObject({ unitId: unit.unitId, role: "bodyguard" });
    expect(units.map((unit) => unit.winner.expectedDamage)).toEqual([...units.map((unit) => unit.winner.expectedDamage)].sort((a, b) => b - a));
    // The overall winner is its own unit's best.
    expect(units[0].winner).toEqual(plain.winner);
    // HC_DEEP=1 deepens only the overall finalist; per-unit mode still searches detachments for the others.
    expect(plain.candidateCounts.deepFinalists).toBe(1);
    expect(units.slice(1).every((unit) => unit.winner.detachments.length > 0)).toBe(true);
  }, 60_000);
});

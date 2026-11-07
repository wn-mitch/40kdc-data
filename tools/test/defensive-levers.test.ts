import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { isLegalLeverSelection } from "../src/data/lever-selection.js";
import { crunch, type EngineInput } from "../src/cruncher/index.js";
import type { EngineContext } from "../src/cruncher/buffs.js";

const ds = Dataset.embedded();

// Psychic Barrier: an optional start-of-phase roll whose 2-6 result gives the unit a 4+
// invulnerable save. The roll is a need; the optional trigger makes its buff a player decision.
const psyker = { unitId: "primaris-psyker", factionId: "astra-militarum" };
const BARRIER = "psychic-barrier-astra-militarum";

function barrierContext(rollHolds?: boolean): EngineContext {
  const base: EngineContext = { phase: "shooting" };
  if (rollHolds === undefined) return base;
  const need = ds.defensiveNeedsFor(psyker, base).find((item) => item.abilityId === BARRIER);
  if (!need) throw new Error("Psychic Barrier no longer raises its roll as a need");
  return { ...base, conditionFacts: { [need.key]: rollHolds } };
}

const invulns = (buffs: { contribution: { type: string } }[]) =>
  buffs.filter((buff) => buff.contribution.type === "invulnerable-save");

describe("Dataset.defensiveLeversFor", () => {
  it("lists an optional ability's buff as an opt-in lever once its roll is answered", () => {
    const { buffs: levers, groups } = ds.defensiveLeversFor(psyker, barrierContext(true));
    const barrier = levers.filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === BARRIER);
    expect(barrier).toHaveLength(1);
    expect(barrier[0]).toMatchObject({
      id: `${BARRIER}@phase-started`,
      label: "Psychic Barrier (Psychic) — 4+ invuln",
      enabled: false,
      source: { kind: "ability", abilityId: BARRIER, abilityKind: "unit" },
    });
    expect(barrier[0].buffs.map((buff) => buff.contribution)).toEqual([{ type: "invulnerable-save", threshold: 4 }]);
    expect(groups.filter((group) => group.abilityId === BARRIER)).toEqual([]);
    // The lever is a decision, so the unconditional stack never carries it.
    expect(invulns(ds.defensiveBuffsFor(psyker, barrierContext(true)))).toEqual([]);
  });

  it("offers no lever while the roll is undecided or answered false", () => {
    for (const context of [barrierContext(), barrierContext(false)]) {
      const ids = ds.defensiveLeversFor(psyker, context).buffs.map((lever) => lever.id);
      expect(ids).not.toContain(`${BARRIER}@phase-started`);
    }
  });

  it("toggled off leaves the target without an invuln; toggled on, the crunch saves on 4+", () => {
    const context = barrierContext(true);
    const lascannon = ds.weapons.getAny("lascannon")!; // AP -3 against Sv 5+: no armour save
    const target = ds.units.getInFaction(psyker.unitId, psyker.factionId)!;
    const { buffs: levers } = ds.defensiveLeversFor(psyker, context);
    const crunchWith = (on: ReadonlySet<string>) => {
      const chosen = levers.filter((lever) => on.has(lever.id)).flatMap((lever) => lever.buffs);
      const input: EngineInput = {
        attacker: { weapon: lascannon.raw, profileIndex: 0 },
        target: { unit: target.raw, profileIndex: 0 },
        modelsFiring: 1,
        buffs: [...ds.defensiveBuffsFor(psyker, context), ...chosen],
        context,
      };
      return crunch(input).stages.find((stage) => stage.name === "after-fnp")!.expected;
    };
    const off = crunchWith(new Set());
    const on = crunchWith(new Set([`${BARRIER}@phase-started`]));
    expect(off).toBeGreaterThan(0);
    // The 4+ invulnerable save stops half the wounds that got through.
    expect(on / off).toBeCloseTo(0.5, 6);
  });

  it("keeps a usage-limited lever in its pool, listed once", () => {
    const { buffs: levers, groups } = ds.defensiveLeversFor({ unitId: "canoness", factionId: "adepta-sororitas" }, { phase: "shooting" });
    const grace = levers.find((lever) => lever.id === "the-emperors-grace-adepta-sororitas@phase-started");
    expect(grace?.group).toBe("the-emperors-grace-adepta-sororitas?usage");
    expect(groups.filter((group) => group.id === grace?.group)).toEqual([
      { id: "the-emperors-grace-adepta-sororitas?usage", abilityId: "the-emperors-grace-adepta-sororitas", label: expect.any(String), maxActivations: 1 },
    ]);
  });

  it("puts a choice's option in the choice's pool of one", () => {
    const { buffs: levers, groups } = ds.defensiveLeversFor({ unitId: "trajann-valoris", factionId: "adeptus-custodes" }, { phase: "fight" });
    const option = levers.find((lever) => lever.group === "moment-shackle-adeptus-custodes?choice");
    expect(option?.buffs.map((buff) => buff.contribution)).toEqual([{ type: "invulnerable-save", threshold: 3 }]);
    expect(groups.find((group) => group.id === "moment-shackle-adeptus-custodes?choice")?.maxActivations).toBe(1);
    expect(isLegalLeverSelection(levers, groups, new Set([option!.id]))).toBe(true);
  });
});

describe("conformance: abilities-resolver/defensive-levers.json", () => {
  it("every row's levers and pools match the reference", () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "conformance", "abilities-resolver", "defensive-levers.json");
    type Row = { caseId: string; input: Parameters<Dataset["defensiveLeversFor"]>[0]; context: EngineContext; expected: { levers: unknown[]; groups: unknown[] } };
    const { cases } = JSON.parse(readFileSync(path, "utf8")) as { cases: Row[] };
    expect(cases.length).toBeGreaterThan(0);
    for (const row of cases) {
      const { buffs, groups } = ds.defensiveLeversFor(row.input, row.context);
      const levers = buffs.map((lever) => ({
        id: lever.id, label: lever.label, enabled: lever.enabled, source: lever.source,
        group: lever.group ?? null, groups: lever.groups ?? null, requires: lever.requires ?? null,
        buffs: lever.buffs.map((buff) => buff.contribution),
      }));
      expect({ levers, groups }, row.caseId).toEqual(row.expected);
    }
  });
});

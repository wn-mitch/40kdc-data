import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { crunch, type EngineInput } from "../src/cruncher/index.js";

const ds = Dataset.embedded();

const APPROX = 5e-4;
function near(actual: number, expected: number, msg = ""): void {
  if (Math.abs(actual - expected) > APPROX) {
    throw new Error(`${msg}: expected ${expected.toFixed(6)}, got ${actual.toFixed(6)}`);
  }
}

function stage(out: ReturnType<typeof crunch>, name: string): number {
  const s = out.stages.find((x) => x.name === name);
  if (!s) throw new Error(`no stage ${name}`);
  return s.expected;
}

function inputFor(
  weaponId: string,
  profileIndex: number,
  modelsFiring: number,
  unitId: string,
  context: EngineInput["context"],
  buffs: EngineInput["buffs"] = [],
  targetModelCount?: number,
): EngineInput {
  const weapon = ds.weapons.get(weaponId);
  const unit = ds.units.get(unitId);
  if (!weapon || !unit) throw new Error(`missing weapon=${weaponId} or unit=${unitId}`);
  return {
    attacker: { weapon: weapon.raw, profileIndex },
    target: {
      unit: unit.raw,
      profileIndex: 0,
      ...(targetModelCount !== undefined ? { modelCount: targetModelCount } : {}),
    },
    modelsFiring,
    buffs,
    context,
  };
}

describe("crunch: bolt-rifle vs intercessor", () => {
  // bolt-rifle profile 0: A=2, S=4, AP=-1, D=1, BS=3; keywords [assault, heavy].
  // intercessor-squad profile 0: T=4, W=2, Sv=3, OC=2, Ld=6.
  // 5 firing models, not stationary (so Heavy is gated off).
  it("matches hand-derived numbers without rerolls or modifiers", () => {
    const out = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", {
        phase: "shooting",
        attackerStationary: false,
        withinHalfRange: false,
      }),
    );
    // attacks: 5 × 2 = 10
    near(stage(out, "attacks"), 10, "attacks");
    // hits: 10 × 4/6 = 6.6667
    near(stage(out, "hits"), 10 * 4 / 6, "hits");
    // wound: S4 vs T4 → 4+, P(wound)=3/6=0.5
    near(stage(out, "wounds"), (10 * 4 / 6) * 0.5, "wounds");
    // save: Sv3 - AP(-1) = 4+, P(save)=3/6=0.5; unsaved = wounds × 0.5
    const wounds = (10 * 4) / 6 * 0.5;
    const unsaved = wounds * 0.5;
    near(stage(out, "unsaved"), unsaved, "unsaved");
    // damage: 1 per hit
    near(stage(out, "damage"), unsaved, "damage");
    // no FNP
    near(stage(out, "after-fnp"), unsaved, "after-fnp");
    // models killed: damage / W; cap at model count (10 by default for intercessors min=10? unknown).
    const W = 2;
    const targetModels = ds.units.get("intercessor-squad")!.raw.model_count?.min ?? 1;
    near(stage(out, "models-killed"), Math.min(targetModels, unsaved / W), "models-killed");
  });

  it("Heavy fires +1 to hit when stationary", () => {
    const out = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", {
        phase: "shooting",
        attackerStationary: true,
        withinHalfRange: false,
      }),
    );
    // With +1 to hit, BS3 effectively → 2+, P(hit) = 5/6.
    near(stage(out, "hits"), 10 * 5 / 6, "hits");
  });
});

describe("crunch: torrent + ignores-cover via manual buffs", () => {
  // Use a real torrent weapon if available; otherwise emulate via manual extra-keyword buffs.
  it("torrent auto-hits", () => {
    // Hand-build a synthetic context: take any ranged weapon, then add a
    // manual torrent extra-keyword.
    const inp = inputFor(
      "bolt-rifle",
      0,
      1,
      "intercessor-squad",
      { phase: "shooting", attackerStationary: false, withinHalfRange: false },
      [
        {
          source: { kind: "manual", label: "test torrent" },
          contribution: { type: "extra-keyword", keywordRef: { keyword_id: "torrent" } },
        },
      ],
    );
    const out = crunch(inp);
    near(stage(out, "attacks"), 2, "attacks");
    near(stage(out, "hits"), 2, "hits"); // torrent: auto-hit
  });
});

describe("crunch: rerolls", () => {
  it("reroll-failed-hits boosts the hit rate", () => {
    const baseline = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", { phase: "shooting" }),
    );
    const buffed = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", { phase: "shooting" }, [
        {
          source: { kind: "ability", abilityId: "guide", abilityKind: "support" },
          contribution: { type: "reroll", roll: "hit", subset: "all-failures" },
        },
      ]),
    );
    expect(stage(buffed, "hits")).toBeGreaterThan(stage(baseline, "hits"));
    // BS3+, P(hit_initial) = 4/6. With reroll all-failures: 4/6 + 2/6 × 4/6 = 4/6 + 8/36 = 32/36 = 0.8889
    near(stage(buffed, "hits"), 10 * (4 / 6 + (2 / 6) * (4 / 6)), "hits with rerolls");
  });
});

describe("crunch: cover", () => {
  it("cover improves save by 1, capped at 3+", () => {
    const baseline = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", { phase: "shooting" }),
    );
    const covered = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", { phase: "shooting" }, [
        { source: { kind: "manual", label: "in cover" }, contribution: { type: "cover" } },
      ]),
    );
    // Intercessor Sv3+ already, AP-1 makes it 4+. Cover would normally be 3+
    // (capped — Sv3+ doesn't improve past 3+). So cover takes 4+ → 3+.
    const woundsBaseline = stage(baseline, "wounds");
    const unsavedCovered = woundsBaseline * (1 - 4 / 6); // need 3+, P(save)=4/6
    near(stage(covered, "unsaved"), unsavedCovered, "covered unsaved");
  });
});

describe("crunch: FNP", () => {
  it("FNP 5+ reduces damage by P(success)", () => {
    const baseline = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", { phase: "shooting" }),
    );
    const withFnp = crunch(
      inputFor("bolt-rifle", 0, 5, "intercessor-squad", { phase: "shooting" }, [
        {
          source: { kind: "ability", abilityId: "test-fnp", abilityKind: "unit" },
          contribution: { type: "feel-no-pain", threshold: 5 },
        },
      ]),
    );
    // FNP 5+: P(succ) = 2/6, so damage × 4/6.
    near(stage(withFnp, "after-fnp"), stage(baseline, "damage") * (4 / 6), "FNP applies");
  });
});

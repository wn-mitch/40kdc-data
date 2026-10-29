import { describe, expect, it } from "vitest";

import { dataset } from "../src/data/index.js";
import type { Detachment, Enhancement, Unit, WargearOption } from "../src/generated.js";
import type { LoadoutModel } from "../src/data/loadout.js";
import {
  assessDetachmentSelection,
  assessEnhancementAssignment,
  summarizeSupportCosts,
  validateCandidateLoadout,
} from "../src/stack-damage/legality.js";

const GV = { edition: "11th", dataslate: "launch" } as const;

function unit(fields: Partial<Unit>): Unit {
  return {
    id: "fixture-unit",
    name: "Fixture Unit",
    faction_id: "fixture",
    profiles: [{ M: 6, T: 4, W: 2, Sv: 3, Ld: 7, OC: 1 }],
    game_version: GV,
    ...fields,
  } as Unit;
}

describe("validateCandidateLoadout", () => {
  it("rejects a hill-climb trial using authoritative whole-loadout validation", () => {
    const candidateUnit = unit({
      weapon_ids: ["rifle", "cannon"],
      wargear_budgets: [{
        items: ["rifle", "cannon"],
        count: 1,
        per_models: 5,
      }],
    });
    const result = validateCandidateLoadout({
      unit: candidateUnit,
      modelCount: 5,
      options: [] as WargearOption[],
      counts: new Map([
        ["rifle", 1],
        ["cannon", 1],
      ]),
      models: [],
    });
    expect(result.legal).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ code: "exceeds-allowance" }),
    ]);
  });
});

describe("shared roster legality", () => {
  it("rejects an Epic Hero enhancement bearer through validateRosterCore", () => {
    const found = dataset.enhancements.all
      .map((enhancement) => ({
        enhancement,
        detachment: dataset.detachments.getAny(enhancement.detachment_id),
      }))
      .map(({ enhancement, detachment }) => ({
        enhancement,
        detachment,
        bearer: detachment
          ? dataset.units.all.find(
              (view) =>
                view.raw.role === "epic-hero" &&
                view.raw.faction_id === detachment.faction_id,
            )
          : undefined,
      }))
      .find(({ detachment, bearer }) => detachment !== undefined && bearer !== undefined);
    expect(found).toBeDefined();
    if (!found?.detachment || !found.bearer) return;

    const result = assessEnhancementAssignment({
      dataset,
      factionId: found.detachment.faction_id,
      detachmentIds: [found.detachment.id],
      members: [{
        unit: found.bearer.raw,
        modelCount: found.bearer.raw.model_count?.min ?? 1,
        loadout: new Map(),
      }],
      bearerIndex: 0,
      enhancement: found.enhancement,
    });
    expect(result.status).toBe("illegal");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "enhancement-on-epic-hero" }),
      ]),
    );
  });

  it("does not claim whole-roster detachment constraints are locally legal", () => {
    const detachment = dataset.detachments.all.find(
      (candidate) =>
        (candidate.unit_minimums?.length ?? 0) > 0 ||
        (candidate.mandatory_warlord_datasheet_ids?.length ?? 0) > 0 ||
        (candidate.keyword_limit_overrides?.length ?? 0) > 0,
    );
    expect(detachment).toBeDefined();
    if (!detachment) return;
    const bearer = dataset.units.all.find(
      (view) => view.raw.faction_id === detachment.faction_id,
    );
    expect(bearer).toBeDefined();
    if (!bearer) return;

    const result = assessDetachmentSelection({
      dataset,
      factionId: detachment.faction_id,
      detachment: detachment as Detachment,
      selectedDetachmentIds: [],
      members: [{
        unit: bearer.raw,
        modelCount: bearer.raw.model_count?.min ?? 1,
        loadout: new Map(),
      }],
    });
    expect(result.status).not.toBe("legal");
  });
});

describe("summarizeSupportCosts", () => {
  it("reports unit, wargear, and enhancement points", () => {
    const support = unit({
      points: [{ models: 1, cost: 50 }],
      wargear_costs: [{ item_id: "cannon", cost: 5 }],
    });
    const enhancement = {
      id: "upgrade",
      name: "Upgrade",
      detachment_id: "fixture-detachment",
      cost: 15,
      game_version: GV,
    } as Enhancement;
    const result = summarizeSupportCosts({
      members: [{
        unit: support,
        modelCount: 1,
        loadout: new Map([["cannon", 2]]),
        enhancement,
      }],
    });
    expect(result).toMatchObject({
      status: "priced",
      totalPoints: 75,
      entries: [{
        unitPoints: 50,
        wargearPoints: 10,
        enhancementPoints: 15,
        totalPoints: 75,
      }],
    });
  });

  it("marks missing support pricing incomplete instead of treating it as free", () => {
    const result = summarizeSupportCosts({
      members: [{
        unit: unit({ points: [] }),
        modelCount: 1,
        loadout: new Map(),
      }],
    });
    expect(result.status).toBe("incomplete");
    expect(result.totalPoints).toBeNull();
    expect(result.issues[0]?.code).toBe("support-points-unresolved");
  });
});

describe("Legionaries heavy melee allowance", () => {
  // The dump lets one ordinary Legionary and the Aspiring Champion take heavy
  // melee weapons; the champion's two-weapon swap carries a pair.
  const legionaries = dataset.units.getInFaction("legionaries", "chaos-space-marines")!.raw;
  const composition = dataset.unitCompositionOf(legionaries) as { models: LoadoutModel[] };
  const options = dataset.wargearOptionsOf(legionaries);
  const check = (heavy: number, boltguns: number, pistols: number) => validateCandidateLoadout({
    unit: legionaries,
    modelCount: 10,
    options,
    counts: new Map([
      ["heavy-melee-weapon", heavy],
      ["boltgun-legionaries", boltguns],
      ["bolt-pistol-legionaries", pistols],
      ["close-combat-weapon-legionaries", 10],
    ]),
    models: composition.models,
  });

  it("accepts the champion's pair plus one Legionary", () => {
    expect(check(3, 8, 9).legal).toBe(true);
  });

  it("rejects a second ordinary Legionary with a heavy melee weapon", () => {
    // Every bolt pistol kept: the champion can add only one blade (via its
    // boltgun), so the other two must sit on ordinary Legionaries.
    expect(check(3, 7, 10).legal).toBe(false);
    expect(check(4, 7, 9).legal).toBe(false);
  });

  it("accepts the champion and one Legionary each swapping a boltgun", () => {
    expect(check(2, 8, 10).legal).toBe(true);
  });

  it("rejects the squad-wide heavy melee loadout the matrix used to pick", () => {
    expect(check(10, 1, 10).legal).toBe(false);
  });
});

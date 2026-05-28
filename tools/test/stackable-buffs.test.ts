import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/index.js";
import { resolveBuffs, type EngineContext } from "../src/cruncher/buffs.js";

const ds = Dataset.embedded();

// Kharn the Betrayer carries Berzerker Frenzy (a reactive on-destroyed dice
// gate) and, as a World Eaters unit, the army-wide Blessings of Khorne
// dice-pool activation. He's a good probe for the activatable-lever surface.
const KHARN = { unitId: "kharn-the-betrayer", factionId: "world-eaters" };

describe("Dataset.stackableBuffsFor", () => {
  it("surfaces Blessings of Khorne's three keyword buffs as grouped opt-in levers", () => {
    const { buffs, groups } = ds.stackableBuffsFor(KHARN, { phase: "fight" });
    const bless = buffs.filter((b) => b.id.startsWith("blessings-of-khorne#"));
    expect(bless.map((b) => b.id)).toEqual([
      "blessings-of-khorne#Martial Excellence",
      "blessings-of-khorne#Warp Blades",
      "blessings-of-khorne#Decapitating Strikes",
    ]);
    // Opt-in (off by default), all under one capped group.
    expect(bless.every((b) => b.enabled === false)).toBe(true);
    expect(bless.every((b) => b.group === "blessings-of-khorne")).toBe(true);
    const group = groups.find((g) => g.id === "blessings-of-khorne");
    expect(group).toEqual({ id: "blessings-of-khorne", label: "Blessings of Khorne", maxActivations: 2 });
    // The labels are prefixed with the ability name at the dataset layer.
    expect(bless[0].label).toBe("Blessings of Khorne — Martial Excellence");
  });

  it("defers Decapitating Strikes' 'vs Infantry' gate to applicableWhen", () => {
    const { buffs } = ds.stackableBuffsFor(KHARN, { phase: "fight" });
    const decap = buffs.find((b) => b.id === "blessings-of-khorne#Decapitating Strikes")!;
    expect(decap.buffs[0].contribution).toMatchObject({ type: "extra-keyword" });
    expect(decap.buffs[0].applicableWhen).toEqual({
      requiresTargetKeyword: "Infantry",
      phases: ["fight"],
    });
  });

  it("does not surface a lever for Berzerker Frenzy (resurrection has no combat buff)", () => {
    const { buffs } = ds.stackableBuffsFor(KHARN, { phase: "fight" });
    expect(buffs.some((b) => b.id.includes("berzerker-frenzy"))).toBe(false);
  });

  it("opting into a lever resolves to the buff in its phase, and only vs the right target", () => {
    const { buffs } = ds.stackableBuffsFor(KHARN, { phase: "fight" });
    const decap = buffs.find((b) => b.id === "blessings-of-khorne#Decapitating Strikes")!;

    const vsInfantry: EngineContext = { phase: "fight", targetKeywords: ["infantry"] };
    const vsVehicle: EngineContext = { phase: "fight", targetKeywords: ["vehicle"] };

    // vs Infantry in the fight phase → Devastating Wounds granted.
    expect(resolveBuffs(decap.buffs, vsInfantry).extraKeywords).toHaveLength(1);
    // vs a non-Infantry target → the deferred gate drops it.
    expect(resolveBuffs(decap.buffs, vsVehicle).extraKeywords).toHaveLength(0);
    // In the shooting phase → the melee grant doesn't fire.
    expect(
      resolveBuffs(decap.buffs, { phase: "shooting", targetKeywords: ["infantry"] }).extraKeywords,
    ).toHaveLength(0);
  });

  it("back-compat: default-enabled levers reproduce buffsFor's output", () => {
    // The enabled, non-stratagem levers flattened == what buffsFor returns
    // (no opted-in stratagems), proving stackableBuffsFor is a superset that
    // doesn't change the auto-applied stack.
    for (const phase of ["shooting", "fight"] as const) {
      const ctx: EngineContext = { phase, targetKeywords: ["infantry"] };
      const legacy = ds.buffsFor(KHARN, ctx);
      const fromStackable = ds
        .stackableBuffsFor(KHARN, ctx)
        .buffs.filter((b) => b.enabled)
        .flatMap((b) => b.buffs);
      expect(fromStackable).toEqual(legacy);
    }
  });
});

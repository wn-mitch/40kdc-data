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

  it("attaching a combined-unit member is additive and tags its buffs with sourceUnitId", () => {
    const base = ds.stackableBuffsFor(KHARN, { phase: "fight" });
    const withBody = ds.stackableBuffsFor(
      { ...KHARN, attachedUnitIds: ["khorne-berzerkers"] },
      { phase: "fight" },
    );
    // Attachment only adds levers — every base lever id is still present.
    const ids = new Set(withBody.buffs.map((b) => b.id));
    expect(base.buffs.every((b) => ids.has(b.id))).toBe(true);
    // Any attached-sourced lever names the member it came from.
    for (const b of withBody.buffs) {
      if (b.source.kind === "ability" && b.source.abilityKind === "attached") {
        expect(b.source.sourceUnitId).toBe("khorne-berzerkers");
      }
    }
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

// Kharn's "Legendary Killer" grants the combined unit melee hit & wound rerolls,
// gated behind a `model-is-leader` condition. That condition (and the 268 uses
// of `is-attached`) was unevaluatable until `EngineContext.attackerAttached`
// carried the attachment fact from `attachedUnitIds` into the DSL translator.
// These guard that the gated rerolls surface only when an attachment is present.
describe("attachment-gated conditions (is-attached / model-is-leader)", () => {
  /** The two reroll contributions Legendary Killer should yield, in either order. */
  function legendaryKillerRerolls(buffs: { id: string; buffs: { contribution: unknown }[] }[]) {
    const lever = buffs.find((b) => b.id.endsWith(":legendary-killer"));
    return (lever?.buffs ?? []).map((b) => b.contribution);
  }

  it("reported direction: Berzerkers led by Kharn get his melee rerolls (sourced attached)", () => {
    const { buffs } = ds.stackableBuffsFor(
      { unitId: "khorne-berzerkers", factionId: "world-eaters", attachedUnitIds: ["kharn-the-betrayer"] },
      { phase: "fight" },
    );
    expect(legendaryKillerRerolls(buffs)).toEqual(
      expect.arrayContaining([
        { type: "reroll", roll: "hit", subset: "ones" },
        { type: "reroll", roll: "wound", subset: "ones" },
      ]),
    );
    const lever = buffs.find((b) => b.id.endsWith(":legendary-killer"))!;
    expect(lever.source).toMatchObject({ abilityKind: "attached", sourceUnitId: "kharn-the-betrayer" });
  });

  it("reverse direction: Kharn leading Berzerkers still yields his rerolls (sourced unit)", () => {
    const { buffs } = ds.stackableBuffsFor(
      { ...KHARN, attachedUnitIds: ["khorne-berzerkers"] },
      { phase: "fight" },
    );
    expect(legendaryKillerRerolls(buffs)).toEqual(
      expect.arrayContaining([
        { type: "reroll", roll: "hit", subset: "ones" },
        { type: "reroll", roll: "wound", subset: "ones" },
      ]),
    );
    const lever = buffs.find((b) => b.id.endsWith(":legendary-killer"))!;
    expect(lever.source).toMatchObject({ abilityKind: "unit" });
  });

  it("negative control: unattached Kharn yields no Legendary Killer rerolls", () => {
    // No attachedUnitIds → attackerAttached undefined → model-is-leader stays
    // "unknown" → the gated rerolls remain unsupported, not surfaced as a buff.
    const { buffs } = ds.stackableBuffsFor(KHARN, { phase: "fight" });
    expect(legendaryKillerRerolls(buffs)).toEqual([]);
  });
});

// The Berzerker Warband detachment carries the Hack and Slash stratagem (improve
// AP by 1 in the fight phase) and the Relentless Rage detachment rule (+1 A / +2
// S after a charge). Both were silently dropped by the DSL translator —
// `improve` wasn't a recognised operation, and `charged-this-turn` wasn't an
// evaluable condition — so neither surfaced as a lever.
describe("Berzerker Warband detachment buffs", () => {
  const WARBAND = { ...KHARN, detachmentId: "berzerker-warband" };

  it("surfaces Hack and Slash as an opt-in stratagem lever that improves AP", () => {
    const { buffs } = ds.stackableBuffsFor(WARBAND, { phase: "fight" });
    const strat = buffs.find((b) => b.id === "detachment-stratagem:hack-and-slash");
    expect(strat, "hack-and-slash lever").toBeDefined();
    // Stratagems cost CP — off by default.
    expect(strat!.enabled).toBe(false);
    expect(strat!.source).toMatchObject({ abilityKind: "detachment-stratagem" });
    // Improving AP by 1 is one *more negative* point of AP.
    expect(resolveBuffs(strat!.buffs, { phase: "fight" }).apMod.value).toBe(-1);
    // The melee attack_type rides on the buff as a fight-phase gate, so it
    // can't leak into shooting.
    expect(resolveBuffs(strat!.buffs, { phase: "shooting" }).apMod.value).toBe(0);
  });

  it("applies Relentless Rage's +1 A / +2 S only when the unit charged this turn", () => {
    // Not charged → the conditional drops, no lever.
    const notCharged = ds.stackableBuffsFor(WARBAND, { phase: "fight", attackerCharged: false });
    expect(notCharged.buffs.some((b) => b.id === "detachment:relentless-rage")).toBe(false);

    // Charged → the detachment rule surfaces (on by default — it's not a strat).
    const charged = ds.stackableBuffsFor(WARBAND, { phase: "fight", attackerCharged: true });
    const rage = charged.buffs.find((b) => b.id === "detachment:relentless-rage");
    expect(rage, "relentless-rage lever").toBeDefined();
    expect(rage!.enabled).toBe(true);
    expect(rage!.source).toMatchObject({ abilityKind: "detachment" });
    const resolved = resolveBuffs(rage!.buffs, { phase: "fight" });
    expect(resolved.attacksMod.value).toBe(1);
    expect(resolved.strengthMod.value).toBe(2);
  });
});

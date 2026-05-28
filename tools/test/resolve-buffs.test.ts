import { describe, expect, it } from "vitest";
import {
  resolveBuffs,
  type Buff,
  type BuffSource,
  type ResolveContext,
} from "../src/cruncher/buffs.js";

const army: BuffSource = { kind: "ability", abilityId: "oath", abilityKind: "army" };
const stratagem: BuffSource = {
  kind: "ability",
  abilityId: "hack-and-slash",
  abilityKind: "detachment-stratagem",
};
const unit: BuffSource = { kind: "ability", abilityId: "fury", abilityKind: "unit" };
const support: BuffSource = { kind: "ability", abilityId: "guide", abilityKind: "support" };
const manual: BuffSource = { kind: "manual", label: "+1 to hit (UI)" };
const kw = (weaponId: string, keywordId: string): BuffSource => ({
  kind: "weapon-keyword",
  weaponId,
  keywordId,
});

const ctx: ResolveContext = { phase: "shooting" };

describe("resolveBuffs", () => {
  it("hit/wound mods sum and clamp to ±1", () => {
    const buffs: Buff[] = [
      { source: army, contribution: { type: "hit-mod", value: 1 } },
      { source: unit, contribution: { type: "hit-mod", value: 1 } },
      { source: manual, contribution: { type: "wound-mod", value: -2 } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.hitMod.value).toBe(1);
    expect(r.hitMod.dominantSource).toEqual(army); // army outranks unit
    expect(r.woundMod.value).toBe(-1);
    expect(r.woundMod.dominantSource).toEqual(manual);
  });

  it("cancelling hit-mods resolve to 0 with no dominant source", () => {
    const buffs: Buff[] = [
      { source: army, contribution: { type: "hit-mod", value: 1 } },
      { source: stratagem, contribution: { type: "hit-mod", value: -1 } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.hitMod.value).toBe(0);
    expect(r.hitMod.dominantSource).toBeNull();
  });

  it("save-mod sums and retains every source", () => {
    const buffs: Buff[] = [
      { source: army, contribution: { type: "save-mod", value: -1 } },
      { source: unit, contribution: { type: "save-mod", value: -1 } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.saveMod.value).toBe(-2);
    expect(r.saveMod.sources).toHaveLength(2);
  });

  it("reroll: all-failures beats ones", () => {
    const buffs: Buff[] = [
      { source: army, contribution: { type: "reroll", roll: "hit", subset: "ones" } },
      { source: unit, contribution: { type: "reroll", roll: "hit", subset: "all-failures" } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.rerolls.hit?.subset).toBe("all-failures");
    expect(r.rerolls.hit?.dominantSource).toEqual(unit);
  });

  it("reroll ties: stable order by source-kind rank", () => {
    const buffs: Buff[] = [
      { source: unit, contribution: { type: "reroll", roll: "hit", subset: "ones" } },
      { source: army, contribution: { type: "reroll", roll: "hit", subset: "ones" } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.rerolls.hit?.dominantSource).toEqual(army); // higher rank wins
  });

  it("feel-no-pain: lowest threshold wins", () => {
    const buffs: Buff[] = [
      { source: army, contribution: { type: "feel-no-pain", threshold: 6 } },
      { source: unit, contribution: { type: "feel-no-pain", threshold: 5 } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.feelNoPain?.threshold).toBe(5);
    expect(r.feelNoPain?.dominantSource).toEqual(unit);
  });

  it("extra-keyword: deduplicated by (id, params)", () => {
    const buffs: Buff[] = [
      {
        source: army,
        contribution: {
          type: "extra-keyword",
          keywordRef: { keyword_id: "lethal-hits" },
        },
      },
      {
        source: unit,
        contribution: {
          type: "extra-keyword",
          keywordRef: { keyword_id: "lethal-hits" },
        },
      },
      {
        source: unit,
        contribution: {
          type: "extra-keyword",
          keywordRef: { keyword_id: "sustained-hits", parameters: { value: 1 } },
        },
      },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.extraKeywords).toHaveLength(2);
    const ids = r.extraKeywords.map((e) => e.keywordRef.keyword_id);
    expect(ids).toEqual(["lethal-hits", "sustained-hits"]);
  });

  it("cover toggles on; engine handles the +1/cap, resolver records the source", () => {
    const buffs: Buff[] = [
      { source: manual, contribution: { type: "cover" } },
      { source: support, contribution: { type: "cover" } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.cover.active).toBe(true);
    // support outranks manual; the better-ranked source wins for provenance.
    expect(r.cover.source).toEqual(support);
  });

  it("applicableWhen.phases gates buffs out", () => {
    const buffs: Buff[] = [
      {
        source: army,
        applicableWhen: { phases: ["fight"] },
        contribution: { type: "hit-mod", value: 1 },
      },
    ];
    const r = resolveBuffs(buffs, { phase: "shooting" });
    expect(r.hitMod.value).toBe(0);
  });

  it("applicableWhen.requiresTargetKeyword filters anti-style buffs", () => {
    const buffs: Buff[] = [
      {
        source: kw("plasma-rifle", "anti"),
        applicableWhen: { requiresTargetKeyword: "infantry" },
        contribution: { type: "wound-mod", value: 1 },
      },
    ];
    const without = resolveBuffs(buffs, { phase: "shooting", targetKeywords: ["vehicle"] });
    expect(without.woundMod.value).toBe(0);
    const withIt = resolveBuffs(buffs, { phase: "shooting", targetKeywords: ["infantry"] });
    expect(withIt.woundMod.value).toBe(1);
  });

  it("damage-mod sums, retains sources", () => {
    const buffs: Buff[] = [
      { source: army, contribution: { type: "damage-mod", value: 1 } },
      { source: unit, contribution: { type: "damage-mod", value: -1 } },
    ];
    const r = resolveBuffs(buffs, ctx);
    expect(r.damageMod.value).toBe(0);
    expect(r.damageMod.sources).toHaveLength(2);
  });
});

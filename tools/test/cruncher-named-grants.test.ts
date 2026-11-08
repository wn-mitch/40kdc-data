import { describe, expect, it } from "vitest";

import type { BuffSource } from "../src/cruncher/index.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { buffContext, bufferSourceFromEligible } from "../src/data/dataset-buffs.js";
import { Dataset } from "../src/data/dataset.js";
import { isLegalLeverSelection } from "../src/data/lever-selection.js";

const source: BuffSource = { kind: "ability", abilityId: "fabricated-named", abilityKind: "detachment" };
const lethal = { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }] } };
const named = { ability_id: "fabricated-named", definition_id: "fabricated-part" };

describe("a grant of a named ability", () => {
  it("translates the definition it prints for the holders", () => {
    const grant = { type: "ability-grant", target: "this-unit", modifier: { ability: named, definition: { type: "ability-part", name: "Fabricated Part", effect: lethal } } };
    const out = effectToBuffs(grant, source, { phase: "shooting" }, "attacker");
    expect(out.applied.map((buff) => buff.contribution)).toEqual([{ type: "extra-keyword", keywordRef: { keyword_id: "lethal-hits" } }]);
    expect(out.unsupported).toEqual([]);
  });

  it("stays unsupported without a printed definition", () => {
    const grant = { type: "ability-grant", target: "this-unit", modifier: { ability: named } };
    const out = effectToBuffs(grant, source, { phase: "shooting" }, "attacker");
    expect(out.applied).toEqual([]);
    expect(out.unsupported.map((entry) => entry.reason)).toEqual(["ability-grant: named ability ownership is not resolved by the buff engine"]);
  });

  // Master of Wolves: a later grant of the record's own abilities names them, since each definition is declared once.
  it("translates a reference to a definition its own record prints elsewhere", () => {
    const printed = { type: "ability-grant", target: { owner: "friendly", all_of: ["NOT THIS UNIT"] }, modifier: { ability: named, definition: { type: "ability-part", name: "Fabricated Part", effect: lethal } } };
    const reference = (definition_id: string) => ({ type: "ability-grant", target: "this-unit", modifier: { ability: { ...named, definition_id } } });
    const out = effectToBuffs({ type: "sequence", steps: [printed, reference("fabricated-part")] }, source, { phase: "shooting" }, "attacker");
    expect(out.applied.map((buff) => buff.contribution)).toEqual([{ type: "extra-keyword", keywordRef: { keyword_id: "lethal-hits" } }]);
    // A definition the record does not print, or another record's, stays unresolved.
    const missing = effectToBuffs({ type: "sequence", steps: [printed, reference("fabricated-other")] }, source, { phase: "shooting" }, "attacker");
    expect(missing.applied).toEqual([]);
    expect(missing.unsupported.map((entry) => entry.reason)).toContain("ability-grant: named ability ownership is not resolved by the buff engine");
    const elsewhere = effectToBuffs({ type: "sequence", steps: [printed, reference("fabricated-part")] }, { ...source, abilityId: "fabricated-other-record" }, { phase: "shooting" }, "attacker");
    expect(elsewhere.applied).toEqual([]);
  });

  it("reaches a unit a friendly filter selects only by holding the ability being resolved", () => {
    const grant = (has: string) => ({
      type: "ability-grant",
      target: { owner: "friendly", all_of: ["KILL TEAM"], has_ability: [has] },
      modifier: { ability: named, definition: { type: "ability-part", name: "Fabricated Part", effect: lethal } },
    });
    const context = { phase: "shooting" as const, attackerKeywords: ["kill team"] };
    expect(effectToBuffs(grant("fabricated-named"), source, context, "attacker").applied).toHaveLength(1);
    // Another ability's holders stay unresolved, and so does a unit another unit provides it to.
    expect(effectToBuffs(grant("fabricated-other"), source, context, "attacker").applied).toEqual([]);
    expect(effectToBuffs(grant("fabricated-named"), { ...source, abilityKind: "support" }, context, "attacker").applied).toEqual([]);
  });
});

describe("Mission Tactics", () => {
  const ds = Dataset.embedded();
  const input = { unitId: "deathwatch-veterans", factionId: "adeptus-astartes", detachmentId: "deathwatch-support" };
  const doctrine = (option: string) => [{ ability_id: "combat-doctrines-adeptus-astartes", option_id: option }];
  const tactics = (buffs: ReturnType<Dataset["buffsFor"]>) => buffs
    .filter((buff) => buff.source.kind === "ability" && buff.source.abilityId === "mission-tactics-deathwatch-support-deathwatch")
    .map((buff) => buff.contribution);
  const sustained = { type: "extra-keyword", keywordRef: { keyword_id: "sustained-hits", parameters: { value: 1 } } };
  const lethalHits = { type: "extra-keyword", keywordRef: { keyword_id: "lethal-hits" } };

  it("applies only the tactic of the active doctrine", () => {
    expect(tactics(ds.buffsFor(input, { phase: "shooting", activeRules: doctrine("devastator-doctrine") }))).toEqual([sustained]);
    expect(tactics(ds.buffsFor(input, { phase: "shooting", activeRules: doctrine("tactical-doctrine") }))).toEqual([lethalHits]);
    expect(tactics(ds.buffsFor(input, { phase: "shooting", activeRules: [] }))).toEqual([]);
  });

  it("offers each tactic as a lever on its own doctrine, so two never stack", () => {
    const eligible = ds.eligibleAbilities(input, "shooting").find((entry) => entry.ability.id === "mission-tactics-deathwatch-support-deathwatch")!;
    const translation = eligible.ability.describeBuffs(bufferSourceFromEligible(eligible), buffContext(ds, input, { phase: "shooting" }, "attacker"), "attacker");
    expect(translation.activatable.map((lever) => [lever.requiresOption?.option_id, lever.buffs.map((buff) => buff.contribution)])).toEqual([
      ["devastator-doctrine", [sustained]],
      ["tactical-doctrine", [lethalHits]],
    ]);
    const { buffs, groups } = ds.stackableBuffsFor(input, { phase: "shooting" });
    const furor = buffs.find((lever) => lever.buffs.some((buff) => JSON.stringify(buff.contribution) === JSON.stringify(sustained) && lever.source.kind === "ability" && lever.source.abilityId.startsWith("mission-tactics")))!;
    const malleus = buffs.find((lever) => lever.buffs.some((buff) => JSON.stringify(buff.contribution) === JSON.stringify(lethalHits) && lever.source.kind === "ability" && lever.source.abilityId.startsWith("mission-tactics")))!;
    const legal = (...ids: string[]) => isLegalLeverSelection(buffs, groups, new Set(ids));
    expect(legal(furor.id, furor.requiresOption!)).toBe(true);
    expect(legal(furor.id, malleus.id, furor.requiresOption!)).toBe(false);
    expect(legal(furor.id, malleus.id, furor.requiresOption!, malleus.requiresOption!)).toBe(false);
  });

  it("follows a chapter army's own Combat Doctrines, declared or picked as a lever", () => {
    // Blood Angels pick their own copy of Combat Doctrines; Mission Tactics names the Space Marine one.
    const chapter = { ...input, factionId: "blood-angels" };
    const own = (option: string) => [{ ability_id: "combat-doctrines-blood-angels", option_id: option }];
    expect(tactics(ds.buffsFor(chapter, { phase: "shooting", activeRules: own("devastator-doctrine") }))).toEqual([sustained]);
    expect(tactics(ds.buffsFor(chapter, { phase: "shooting", activeRules: own("assault-doctrine") }))).toEqual([]);
    const { buffs, groups } = ds.stackableBuffsFor(chapter, { phase: "shooting" });
    const furor = buffs.find((lever) => lever.buffs.some((buff) => JSON.stringify(buff.contribution) === JSON.stringify(sustained) && lever.source.kind === "ability" && lever.source.abilityId.startsWith("mission-tactics")))!;
    expect(furor.requiresOption).toMatch(/combat-doctrines-blood-angels#devastator-doctrine$/u);
    expect(groups.some((group) => group.id === buffs.find((lever) => lever.id === furor.requiresOption)?.group && group.abilityId === "combat-doctrines-blood-angels")).toBe(true);
    expect(isLegalLeverSelection(buffs, groups, new Set([furor.id, furor.requiresOption!]))).toBe(true);
  });
});

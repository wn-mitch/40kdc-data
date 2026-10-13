import { describe, expect, it } from "vitest";

import { resolveBuffs, type Buff, type BuffSource, type EngineContext } from "../src/cruncher/index.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";

// Fabricated rules only; no GW rule prose.

const own: BuffSource = { kind: "ability", abilityId: "fabricated", abilityKind: "unit" };
const provided: BuffSource = { kind: "ability", abilityId: "fabricated", abilityKind: "support", sourceUnitId: "fabricated-lord" };
const fight: EngineContext = { phase: "fight", attackerKeywords: ["infantry", "destroyer cult"] };
const shooting: EngineContext = { phase: "shooting", attackerKeywords: ["infantry"] };

const notThisUnit = { operator: "not", operands: [{ type: "same-unit", parameters: { as: "ability-unit" } }] };
const within9 = { type: "within", parameters: { subject: "selected-unit", of: "this-model", range: { inches: 9 } } };
const friendlySelection = (keywords: string[]) => ({
  type: "select-units",
  selector: { owner: "friendly", count: 1, keywords, eligibility: { operator: "and", operands: [notThisUnit, within9] } },
  effect: { type: "re-roll", target: "selected-unit", modifier: { roll: "wound", subset: "ones" } },
});

describe("unit selections as levers", () => {
  it("offers a friendly selection another unit provides as one lever requiring the selection", () => {
    const result = effectToBuffs(friendlySelection(["DESTROYER CULT"]), provided, fight);
    expect(result.applied).toEqual([]);
    expect(result.unsupported).toEqual([]);
    expect(result.activatable).toHaveLength(1);
    const [lever] = result.activatable;
    expect(lever.id).toBe("fabricated#selected");
    expect(lever.buffs.map((buff) => buff.contribution)).toEqual([{ type: "reroll", roll: "wound", subset: "ones" }]);
    const { effect: _effect, ...selection } = friendlySelection(["DESTROYER CULT"]);
    expect(lever.requires).toEqual([selection]);
  });

  it("gives the unit holding the ability nothing when the selection excludes its own unit", () => {
    const result = effectToBuffs(friendlySelection(["DESTROYER CULT"]), own, fight);
    expect(result).toEqual({ applied: [], unsupported: [], activatable: [] });
  });

  it("offers nothing to a unit without the selector's keywords, and refuses when its keywords are unknown", () => {
    expect(effectToBuffs(friendlySelection(["NOBZ"]), provided, fight).activatable).toEqual([]);
    const unknown = effectToBuffs(friendlySelection(["DESTROYER CULT"]), provided, { phase: "fight" });
    expect(unknown.activatable).toEqual([]);
    expect(unknown.unsupported.map((item) => item.reason)).toEqual(["select-units: the crunched unit's keywords are unavailable for the selector"]);
  });

  it("reads an enemy selection's incoming grant as the attacker's own, behind its roll, gated on the selector's exclusions", () => {
    const selector = { owner: "enemy", count: 1, excluded_keywords: ["MONSTER", "VEHICLE"], visibility_required: true };
    const roll = { type: "dice-gated", dice: "D6", threshold: 2, comparison: "gte" };
    const effect = {
      type: "select-units",
      selector,
      effect: { ...roll, on_success: { type: "sequence", steps: [
        { type: "designate", target: "selected-unit", modifier: { tag: "fabricated" } },
        { type: "weapon-ability-grant", target: "selected-unit", modifier: { abilities: ["Ignores Cover"], weapon_type: "ranged", incoming: true } },
      ] }, on_fail: null },
    };
    const result = effectToBuffs(effect, provided, shooting);
    expect(result.activatable).toHaveLength(1);
    const [lever] = result.activatable;
    expect(lever.requires).toEqual([{ type: "select-units", selector }, roll]);
    expect(lever.buffs).toEqual([{
      source: provided,
      contribution: { type: "extra-keyword", keywordRef: { keyword_id: "ignores-cover" } },
      applicableWhen: { phases: ["shooting"], excludedTargetKeywords: ["MONSTER", "VEHICLE"] },
    }]);
    expect(resolveBuffs(lever.buffs, { phase: "shooting", targetKeywords: ["infantry"] }).extraKeywords).toHaveLength(1);
    expect(resolveBuffs(lever.buffs, { phase: "shooting", targetKeywords: ["vehicle"] }).extraKeywords).toHaveLength(0);
    // The enemy unit is never the attacked unit's own side: nothing under the target perspective.
    expect(effectToBuffs(effect, provided, shooting, "target").activatable).toEqual([]);
  });

  it("refuses an enemy selection behind a roll with a failure branch rather than dropping the branch", () => {
    const effect = {
      type: "select-units",
      selector: { owner: "enemy", count: 1 },
      effect: { type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte",
        on_success: { type: "stat-modifier", target: "selected-unit", modifier: { stat: "T", operation: "worsen", value: 1 } },
        on_fail: { type: "mortal-wounds", target: "this-unit", modifier: { count: 1 } } },
    };
    const result = effectToBuffs(effect, own, shooting);
    expect(result.activatable).toEqual([]);
    expect(result.unsupported.map((item) => item.reason)).toEqual(["select-units: a dice gate with a failure branch is not a single lever"]);
  });
});

describe("abilities another unit provides", () => {
  it("never applies the provider's own-unit effects to the crunched unit", () => {
    const effect = { type: "sequence", steps: [
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "add", value: 1 } },
      { type: "roll-modifier", target: { owner: "friendly", all_of: ["INFANTRY"] }, modifier: { roll: "hit", operation: "add", value: 1 } },
    ] };
    expect(effectToBuffs(effect, own, shooting).applied.map((buff) => buff.contribution.type)).toEqual(["attacks-mod", "hit-mod"]);
    expect(effectToBuffs(effect, provided, shooting).applied.map((buff) => buff.contribution.type)).toEqual(["hit-mod"]);
  });

  it("applies a friendly filter only to a unit with its keywords, and stays permissive without them", () => {
    const effect = { type: "roll-modifier", target: { owner: "friendly", all_of: ["BLOOD LEGIONS"] }, modifier: { roll: "hit", operation: "add", value: 1 } };
    expect(effectToBuffs(effect, provided, shooting).applied).toEqual([]);
    expect(effectToBuffs(effect, provided, { phase: "shooting", attackerKeywords: ["blood legions"] }).applied).toHaveLength(1);
    expect(effectToBuffs(effect, provided, { phase: "shooting" }).applied).toHaveLength(1);
  });
});

describe("capped and cap-raising levers", () => {
  it("offers a capped scaling at its cap, requiring the scaling, and refuses an uncapped one", () => {
    const scaling = { per: 1, of: "models-embarked-in-bearer", max_value: 22 };
    const capped = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 2, weapon_name: "fabricated claws" }, scaling }, own, fight);
    expect(capped.applied).toEqual([]);
    expect(capped.activatable).toHaveLength(1);
    expect(capped.activatable[0].requires).toEqual([scaling]);
    expect(capped.activatable[0].buffs.map((buff) => [buff.contribution, buff.applicableWhen])).toEqual([[{ type: "attacks-mod", value: 22 }, { weaponName: "fabricated claws" }]]);
    const { max_value: _cap, ...uncapped } = scaling;
    const refused = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 2 }, scaling: uncapped }, own, fight);
    expect(refused.activatable).toEqual([]);
    expect(refused.unsupported.map((item) => item.reason)).toEqual(["stat-modifier: the value scales with models-embarked-in-bearer; not resolved by the buff engine"]);
  });

  it("offers an added selection to the unit's own ability as a cap raise with no buffs", () => {
    const result = effectToBuffs({ type: "ability-modifier", target: "this-unit", modifier: { ability: "fabricated-augments", aspect: "selections", operation: "add", value: 1 } }, own, shooting);
    expect(result.unsupported).toEqual([]);
    expect(result.activatable).toEqual([{ id: "fabricated#cap", label: "One more fabricated-augments selection", buffs: [], capRaise: { ability: "fabricated-augments", by: 1 } }]);
    const uses = effectToBuffs({ type: "ability-modifier", target: "this-unit", modifier: { ability: "fabricated-augments", aspect: "uses", operation: "add", value: 1 } }, own, shooting);
    expect(uses.activatable).toEqual([]);
  });
});

describe("weapon-keyword gates", () => {
  const rapidFire: Buff = effectToBuffs({ type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Rapid Fire 1"], weapon_type: "ranged", weapon_keyword: "Lethal Hits" } }, own, shooting).applied[0];
  const lethal: Buff = { source: own, contribution: { type: "extra-keyword", keywordRef: { keyword_id: "lethal-hits" } } };

  it("reaches a weapon with the keyword printed, or granted by another live buff, and no other", () => {
    expect(rapidFire.applicableWhen).toEqual({ phases: ["shooting"], weaponKeyword: "lethal-hits" });
    const granted = (buffs: Buff[], printed: string[]) => resolveBuffs(buffs, { phase: "shooting", weaponKeywords: printed }).extraKeywords.map((k) => k.keywordRef.keyword_id);
    expect(granted([rapidFire], ["lethal-hits"])).toEqual(["rapid-fire"]);
    expect(granted([rapidFire], ["heavy"])).toEqual([]);
    expect(granted([rapidFire, lethal], ["heavy"])).toEqual(["rapid-fire", "lethal-hits"]);
  });

  it("stays permissive when the caller does not name the weapon's keywords", () => {
    expect(resolveBuffs([rapidFire], { phase: "shooting" }).extraKeywords).toHaveLength(1);
  });
});

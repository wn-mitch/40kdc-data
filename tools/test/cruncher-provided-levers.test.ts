import { describe, expect, it } from "vitest";

import { conditionFactKey, resolveBuffs, type Buff, type BuffSource, type EngineContext } from "../src/cruncher/index.js";
import { effectToBuffs, momentGate } from "../src/cruncher/from-dsl.js";
import { Dataset, emptyRawData } from "../src/data/index.js";

// Fabricated rules only; no GW rule prose.

const own: BuffSource = { kind: "ability", abilityId: "fabricated", abilityKind: "unit" };
const provided: BuffSource = { kind: "ability", abilityId: "fabricated", abilityKind: "support", sourceUnitId: "fabricated-lord" };
const fight: EngineContext = { phase: "fight", attackerKeywords: ["infantry", "destroyer cult"] };
const shooting: EngineContext = { phase: "shooting", attackerKeywords: ["infantry"] };

const notThisUnit = { operator: "not", operands: [{ type: "same-unit", parameters: { as: "ability-unit" } }] };
const within9 = { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "this-model", range: { inches: 9 } } } } };
const friendlySelection = (keywords: string[]) => ({
  type: "select-units",
  selector: { filter: { owner: "friendly", all_of: keywords }, count: { min: 1, max: 1 }, eligibility: { operator: "and", operands: [notThisUnit, within9] } },
  effect: { type: "re-roll", target: "selected-unit", modifier: { roll: "wound", subset: "ones" } },
});

describe("exact unit identity filters", () => {
  it("matches the selected perspective's ID without keyword or case substitution", () => {
    const effect = { type: "stat-modifier", target: { level: "unit", unit_ids: ["example-unit"] }, modifier: { stat: "S", operation: "add", value: 1 } };
    expect(effectToBuffs(effect, own, { ...shooting, attackerUnitId: "example-unit" }).applied).toHaveLength(1);
    expect(effectToBuffs(effect, own, { ...shooting, attackerUnitId: "EXAMPLE-UNIT", attackerKeywords: ["example-unit"] }).applied).toEqual([]);
    expect(effectToBuffs(effect, own, { ...shooting, attackerUnitId: "different", targetUnitId: "example-unit" }).applied).toEqual([]);
    expect(effectToBuffs(effect, own, shooting).unsupported).toHaveLength(1);
    const defensive = { ...effect, modifier: { stat: "T", operation: "add", value: 1 } };
    expect(effectToBuffs(defensive, own, { ...shooting, attackerUnitId: "different", targetUnitId: "example-unit" }, "target").applied).toHaveLength(1);
  });
});

describe("explicit range applicability", () => {
  it("requires known inclusive distance without changing ungated buffs", () => {
    const buff: Buff = { source: own, contribution: { type: "strength-mod", value: 1 }, applicableWhen: { maxRangeInches: 6 } };
    expect(resolveBuffs([buff], shooting).strengthMod.value).toBe(0);
    for (const distanceInches of [0, 5.99, 6]) {
      expect(resolveBuffs([buff], { ...shooting, distanceInches }).strengthMod.value).toBe(1);
    }
    expect(resolveBuffs([buff], { ...shooting, distanceInches: 6.01 }).strengthMod.value).toBe(0);
    const { applicableWhen: _gate, ...ungated } = buff;
    expect(resolveBuffs([ungated], shooting).strengthMod.value).toBe(1);
  });
});

describe("activation diagnostics", () => {
  it("reports canonical source instead of an internal timing gate", () => {
    const trigger = { event: "battle-started", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } } };
    const effect = { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } };
    const part = { type: "ability-part", name: "Example activation", trigger, effect };
    // No phase or battle state is known: the activation gate must report itself unevaluable.
    const result = effectToBuffs({ type: "choice", options: [momentGate(trigger, effect, part)] }, own, {} as EngineContext);
    // The undecided attachment leaf is the one need; the internal moment gate is not.
    expect(result.unsupported).toEqual([{
      reason: "activation condition cannot be evaluated against current context",
      effectFragment: part,
      needs: [{ key: conditionFactKey(trigger.condition, "attacker"), condition: trigger.condition, perspective: "attacker" }],
      scope: "unresolved",
    }]);
    expect(JSON.stringify(result.unsupported)).not.toContain("timing-is");
  });
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
    expect(unknown.unsupported.map((item) => item.reason)).toEqual(["select-units: candidate identity or state is unavailable"]);
  });

  it("reads an enemy selection's incoming grant as the attacker's own, behind its roll, gated on the selector's exclusions", () => {
    const selector = { filter: { owner: "enemy", none_of: ["MONSTER", "VEHICLE"], visible: { to: "this-unit" } }, count: { min: 1, max: 1 } };
    const roll = { type: "dice-gated", dice: "D6", threshold: 2, comparison: "gte" };
    const effect = {
      type: "select-units",
      selector,
      effect: { ...roll, on_success: { type: "sequence", steps: [
        { type: "designate", target: "selected-unit", modifier: { tag: "fabricated" } },
        { type: "weapon-ability-grant", target: "selected-unit", modifier: { keywords: [{ keyword_id: "ignores-cover" }], weapons: { type: "ranged" }, incoming: true } },
      ] }, on_fail: null },
    };
    const result = effectToBuffs(effect, provided, shooting);
    expect(result.activatable).toHaveLength(1);
    const [lever] = result.activatable;
    expect(lever.requires).toEqual([{ type: "select-units", selector }, roll]);
    expect(lever.buffs).toEqual([{
      source: provided,
      contribution: { type: "extra-keyword", keywordRef: { keyword_id: "ignores-cover" } },
      applicableWhen: { phases: ["shooting"], targetFilter: { owner: "enemy", none_of: ["MONSTER", "VEHICLE"] } },
    }]);
    expect(resolveBuffs(lever.buffs, { phase: "shooting", targetKeywords: ["infantry"] }).extraKeywords).toHaveLength(1);
    expect(resolveBuffs(lever.buffs, { phase: "shooting", targetKeywords: ["vehicle"] }).extraKeywords).toHaveLength(0);
    // The enemy unit is never the attacked unit's own side: nothing under the target perspective.
    expect(effectToBuffs(effect, provided, shooting, "target").activatable).toEqual([]);
  });

  it("refuses an enemy selection behind a roll with a failure branch rather than dropping the branch", () => {
    const effect = {
      type: "select-units",
      selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } },
      effect: { type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte",
        on_success: { type: "stat-modifier", target: "selected-unit", modifier: { stat: "T", operation: "worsen", value: 1 } },
        on_fail: { type: "mortal-wounds", target: "this-unit", modifier: { count: 1 } } },
    };
    const result = effectToBuffs(effect, own, shooting);
    expect(result.activatable).toEqual([]);
    expect(result.unsupported.map((item) => item.reason)).toEqual(["select-units: a dice gate with a failure branch is not a single lever"]);
  });

  it("binds Bodyguard model membership to the selected unit, including named selections", () => {
    for (const binding of [undefined, "picked"]) {
      const effect = {
        type: "select-units",
        selector: { filter: { owner: "friendly" }, count: { min: 0, max: 1 }, ...(binding ? { bind_as: binding } : {}) },
        effect: { type: "stat-modifier", target: {
          level: "model", member_of: binding ? { selection_var: binding } : "selected-unit", attachment_role: "bodyguard",
        }, modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } },
      };
      const result = effectToBuffs(effect, provided, { ...fight, attackerAttachmentRole: "bodyguard" });
      expect(result.unsupported).toEqual([]);
      expect(result.activatable).toHaveLength(1);
      expect(result.activatable[0].buffs[0].contribution).toEqual({ type: "strength-mod", value: 1 });
      expect(effectToBuffs(effect, provided, { ...fight, attackerAttachmentRole: "leader" }).activatable).toEqual([]);
    }
  });

  it("applies quantified Bodyguard recipients without granting their modifiers to Leaders", () => {
    const effect = {
      type: "for-each-unit",
      selector: { filter: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" } },
      effect: { type: "sequence", steps: [
        { type: "stat-modifier", target: "recipient", modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } },
        { type: "stat-modifier", target: "recipient", modifier: { stat: "T", operation: "add", value: 1 } },
      ] },
    };
    const context: EngineContext = { ...fight, attackerAttachmentRole: "bodyguard", targetAttachmentRole: "bodyguard", attackerKeywords: ["character"] };
    const attacker = effectToBuffs(effect, own, context);
    expect(attacker.unsupported.map((fragment) => fragment.reason)).toEqual(["stat-modifier T: defender-side stat; applies when the buffed unit is the target"]);
    expect(attacker.applied.map((buff) => buff.contribution)).toEqual([{ type: "strength-mod", value: 1 }]);
    expect(resolveBuffs(attacker.applied, { phase: "shooting" }).strengthMod.value).toBe(0);
    expect(effectToBuffs(effect, own, context, "target").applied.map((buff) => buff.contribution)).toEqual([{ type: "toughness-mod", value: 1 }]);
    expect(effectToBuffs(effect, own, { ...context, attackerAttachmentRole: "leader" }).applied).toEqual([]);
    expect(effectToBuffs(effect, own, { ...fight }).unsupported).toHaveLength(2);
  });

  it("does not substitute current membership for battle-start recipients through the public ability API", () => {
    const raw = emptyRawData();
    raw.abilities = [{
      ability_id: "snapshot-example", name: "Snapshot example", faction_id: "example",
      ability_type: "enhancement", behavior: "reactive",
      game_version: { edition: "11th", dataslate: "test" }, authored_by: "40kdc-community",
      trigger: { event: "battle-started", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } } },
      scope: { duration: "battle" },
      effect: { type: "for-each-unit", selector: { filter: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" } },
        effect: { type: "stat-modifier", target: "recipient", modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } } },
    }] as never;
    const ability = new Dataset(raw).abilities.get("snapshot-example")!;
    const contexts: EngineContext[] = [
      { ...fight, attackerAttached: true, attackerAttachmentRole: "bodyguard", attachmentRoles: { source: "leader" } },
      { ...fight, attackerAttached: false, attachmentRoles: {} },
      { ...fight, attackerAttached: true, attackerAttachmentRole: "leader", attachmentRoles: { source: "bodyguard" } },
    ];
    for (const context of contexts) {
      const result = ability.describeBuffs({ ...own, abilityId: "snapshot-example" }, context);
      expect(result.applied).toEqual([]);
      expect(result.activatable).toEqual([]);
      expect(result.unsupported.map((fragment) => fragment.reason)).toEqual([
        "trigger-time recipient snapshot is unavailable; current membership cannot establish historical recipients",
      ]);
    }
  });

  it("evaluates leading against the source model rather than the crunched member", () => {
    const effect = { type: "conditional", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } },
      effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } } };
    const source: BuffSource = { kind: "ability", abilityId: "fabricated", abilityKind: "attached", sourceUnitId: "source" };
    const context: EngineContext = { ...fight, attackerAttached: true, attackerAttachmentRole: "bodyguard", attachmentRoles: { source: "leader" } };
    expect(effectToBuffs(effect, source, context).applied).toHaveLength(1);
    expect(effectToBuffs(effect, source, { ...context, attackerAttachmentRole: "leader", attachmentRoles: { source: "bodyguard" } }).applied).toEqual([]);
    expect(effectToBuffs(effect, own, { ...fight, attackerAttached: false }).applied).toEqual([]);
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

  it("applies a friendly filter only when its keywords are known to match", () => {
    const effect = { type: "roll-modifier", target: { owner: "friendly", all_of: ["BLOOD LEGIONS"] }, modifier: { roll: "hit", operation: "add", value: 1 } };
    expect(effectToBuffs(effect, provided, shooting).applied).toEqual([]);
    expect(effectToBuffs(effect, provided, { phase: "shooting", attackerKeywords: ["blood legions"] }).applied).toHaveLength(1);
    expect(effectToBuffs(effect, provided, { phase: "shooting" }).unsupported).toHaveLength(1);
  });
});

describe("capped and cap-raising levers", () => {
  it("offers a capped scaling at its cap, requiring the scaling, and refuses an uncapped one", () => {
    const scaling = { per: 1, of: "models-embarked-in-bearer", max_value: 22 };
    const capped = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 2, weapons: { name: "fabricated claws" } }, scaling }, own, fight);
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
    const modifier = { ability_id: "fabricated-augments", allocation: "fixed-option", additional_selections: 1, option: { ability_id: "fabricated-augments", option_id: "stable-option" } };
    const result = effectToBuffs({ type: "stance-selection-capacity", modifier }, own, shooting);
    expect(result.unsupported).toEqual([]);
    expect(result.activatable).toEqual([{ id: "fabricated#cap", label: "1 more fabricated-augments selections", buffs: [], capRaise: { ability: "fabricated-augments", by: 1, allocation: "fixed-option", option: modifier.option } }]);
  });
});

describe("weapon-keyword gates", () => {
  const rapidFire: Buff = effectToBuffs({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "rapid-fire", parameters: { value: 1 } }], weapons: { type: "ranged", keyword: { keyword_id: "lethal-hits" } } } }, own, shooting).applied[0];
  const lethal: Buff = { source: own, contribution: { type: "extra-keyword", keywordRef: { keyword_id: "lethal-hits" } } };

  it("reaches a weapon with the keyword printed, or granted by another live buff, and no other", () => {
    expect(rapidFire.applicableWhen).toEqual({ phases: ["shooting"], weaponKeywords: [{ keyword_id: "lethal-hits" }] });
    const granted = (buffs: Buff[], printed: string[]) => resolveBuffs(buffs, { phase: "shooting", weaponKeywords: printed }).extraKeywords.map((k) => k.keywordRef.keyword_id);
    expect(granted([rapidFire], ["lethal-hits"])).toEqual(["rapid-fire"]);
    expect(granted([rapidFire], ["heavy"])).toEqual([]);
    expect(granted([rapidFire, lethal], ["heavy"])).toEqual(["rapid-fire", "lethal-hits"]);
  });

  it("does not assume unknown weapon keywords satisfy a selector", () => {
    expect(resolveBuffs([rapidFire], { phase: "shooting" }).extraKeywords).toHaveLength(0);
  });
});

describe("canonical identities and activation boundaries", () => {
  const hit = { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } };
  const wound = { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } };

  it("retains named selector bindings, bounded counts and nonuniform limits as requirements", () => {
    const selector = {
      filter: { owner: "friendly", all_of: ["INFANTRY"], not_all_of: ["CHARACTER", "VEHICLE"] },
      count: { min: 1, max: 2 }, limit: { count: 1, period: "phase" }, bind_as: "chosen",
      eligibility: { type: "matches", parameters: { filter: { visible: { to: "ability-unit" } } } },
    };
    const result = effectToBuffs({ type: "select-units", selector, effect: { ...hit, target: { selection_var: "chosen" } } }, own, shooting);
    expect(result.unsupported).toEqual([]);
    expect(result.activatable[0].requires).toEqual([{ type: "select-units", selector }]);
    expect(result.activatable[0].buffs[0].contribution).toEqual({ type: "hit-mod", value: 1 });
  });

  it("keeps option IDs stable across renames and respects multi-pick capacity", () => {
    const stance = (name: string) => ({ type: "stance-select", mode: "re-selectable", min_choices: 0, max_choices: 2,
      options: [{ id: "first", name, effect: hit }, { id: "second", name: "Second label", effect: wound }] });
    const before = effectToBuffs(stance("Original label"), own, shooting);
    const after = effectToBuffs(stance("Renamed label"), own, shooting);
    expect(before.activatable.map((lever) => lever.id)).toEqual(["fabricated#first", "fabricated#second"]);
    expect(after.activatable.map((lever) => lever.id)).toEqual(before.activatable.map((lever) => lever.id));
    expect(after.activatable.map((lever) => lever.group)).toEqual([
      { id: "fabricated?stance", maxActivations: 2 }, { id: "fabricated?stance", maxActivations: 2 },
    ]);
  });

  it("retains a shared parent allowance across independent costed parts", () => {
    const cost = { type: "resource-spend", target: "this-unit", modifier: { pool: "test-pool", amount: 1 } };
    const usage = [{ frequency: "n-per-battle", count: 3, per: "army" }, { frequency: "once-per-phase", count: 2, per: "army" }];
    const result = effectToBuffs({ type: "rules-bundle", steps: [
      { type: "ability-part", name: "First", cost, effect: hit },
      { type: "ability-part", name: "Second", optional: true, effect: wound },
    ] }, own, shooting, "attacker", { usage });
    expect(result.applied).toEqual([]);
    expect(result.activatable).toHaveLength(2);
    for (const lever of result.activatable) {
      expect(lever.group).toEqual({ id: "fabricated?usage", maxActivations: 2 });
      expect(lever.requires?.[0]).toEqual({ usage });
    }
    expect(result.activatable[0].requires?.[1]).toMatchObject({ cost });
  });

  it("retains both the option group and its parent usage group", () => {
    const result = effectToBuffs({ type: "stance-select", mode: "re-selectable", options: [
      { id: "first", name: "First", effect: hit }, { id: "second", name: "Second", effect: wound },
    ] }, own, shooting, "attacker", { usage: { frequency: "once-per-battle-round", per: "army" } });
    expect(result.activatable[0].group).toEqual({ id: "fabricated?stance", maxActivations: 1 });
    expect(result.activatable[0].groups).toEqual([{ id: "fabricated?usage", maxActivations: 1 }]);
  });

  it("uses actual bodyguard membership rather than CHARACTER or Leader capability", () => {
    const effect = { ...hit, target: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" } };
    expect(effectToBuffs(effect, own, { ...shooting, attackerKeywords: ["character"], attackerAttachmentRole: "bodyguard" }).applied).toHaveLength(1);
    expect(effectToBuffs(effect, own, { ...shooting, attackerAttachmentRole: "leader" }).applied).toEqual([]);
    expect(effectToBuffs(effect, own, shooting).unsupported).toHaveLength(1);
  });

  it("never widens a model-only granted definition to all models", () => {
    const effect = { type: "ability-grant", target: "this-model", modifier: { definition: { type: "ability-part", effect: hit } } };
    const result = effectToBuffs(effect, own, shooting);
    expect(result.applied).toEqual([]);
    expect(result.unsupported[0].reason).toContain("model-only");
  });

  it("evaluates canonical matches and round-indexed ranges without guessing unknowns", () => {
    const effect = { type: "conditional", condition: { type: "matches", parameters: {
      subject: "attacker", filter: { not_all_of: ["CHARACTER", "VEHICLE"], within: { of: "defender", range: { per_battle_round: [{ inches: 3 }, { inches: 6 }] } } },
    } }, effect: hit };
    expect(effectToBuffs(effect, own, { ...shooting, distanceInches: 5, battleRound: 1 }).applied).toEqual([]);
    expect(effectToBuffs(effect, own, { ...shooting, distanceInches: 5, battleRound: 7 }).applied).toHaveLength(1);
    expect(effectToBuffs(effect, own, shooting).unsupported).toHaveLength(1);
  });

  it("checks structured keyword ratings and exclusions, including granted keywords", () => {
    const result = effectToBuffs({ type: "weapon-ability-grant", target: "this-unit", modifier: {
      keywords: [{ keyword_id: "rapid-fire", parameters: { value: 1 } }],
      weapons: { keyword: { keyword_id: "sustained-hits", parameters: { value: 2 } }, exclude_keyword: { keyword_id: "heavy" } },
    } }, own, shooting);
    const context = { ...shooting, weaponKeywordRefs: [{ keyword_id: "sustained-hits", parameters: { value: 2 } }] };
    expect(resolveBuffs(result.applied, context).extraKeywords).toHaveLength(1);
    expect(resolveBuffs(result.applied, { ...context, weaponKeywordRefs: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] }).extraKeywords).toEqual([]);
    const heavy: Buff = { source: own, contribution: { type: "extra-keyword", keywordRef: { keyword_id: "heavy" } } };
    expect(resolveBuffs([...result.applied, heavy], context).extraKeywords.map((entry) => entry.keywordRef.keyword_id)).toEqual(["heavy"]);
  });
});

it("binds a granted unit ability's self references to its holder, not its provider", () => {
  const result = effectToBuffs({
    type: "ability-grant", target: { owner: "friendly", all_of: ["INFANTRY"] },
    modifier: { definition: { type: "ability-part", effect: {
      type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 },
    } } },
  }, provided, shooting);
  expect(result.unsupported).toEqual([]);
  expect(result.applied.map((buff) => buff.contribution)).toEqual([{ type: "hit-mod", value: 1 }]);
});

it("preserves menu costs and shared allowances without discarding canonical eligibility", () => {
  const action = {
    id: "steady", label: "Steady",
    when: { event: "selected", filter: { to: "shoot" } },
    cost: { pool_id: "focus", amount: 1 },
    eligibility: { filter: { all_of: ["INFANTRY"], none_of: ["VEHICLE"] }, count: { min: 1, max: 1 } },
    effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
  };
  const menu = { type: "resource-action-menu", menu_id: "actions", pool_id: "focus",
    shared_usage: { unit_max_manoeuvres_per_phase: 2 }, actions: [action] };
  const result = effectToBuffs(menu, own, shooting);
  expect(result.unsupported).toEqual([]);
  expect(result.activatable[0].id).toBe("fabricated#steady");
  expect(result.activatable[0].group).toEqual({ id: "fabricated?menu", maxActivations: 2 });
  expect(result.activatable[0].requires?.[0]).toMatchObject({ menu_id: "actions", pool_id: "focus", action: { cost: action.cost, eligibility: action.eligibility } });
  expect(effectToBuffs(menu, own, { phase: "shooting" }).unsupported).toHaveLength(1);
});

it("does not treat an unknown printed keyword rating as satisfying an exclusion", () => {
  const buff: Buff = {
    source: own,
    applicableWhen: { excludedWeaponKeywords: [{ keyword_id: "sustained-hits", parameters: { value: 2 } }] },
    contribution: { type: "hit-mod", value: 1 },
  };
  expect(resolveBuffs([buff], { ...shooting, weaponKeywords: ["sustained-hits"] }).hitMod.value).toBe(0);
  expect(resolveBuffs([buff], { ...shooting, weaponKeywordRefs: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] }).hitMod.value).toBe(1);
  expect(resolveBuffs([buff], { ...shooting, weaponKeywords: ["heavy"] }).hitMod.value).toBe(1);
});

describe("structured keyword quantity safety", () => {
  it("reports unresolved grants but preserves numeric, dice and unparameterized identities", () => {
    const grant = (value: unknown) => ({ type: "weapon-ability-grant", target: "this-unit", modifier: {
      keywords: [{ keyword_id: "sustained-hits", parameters: { value } }],
    } });
    for (const value of [{ rating: true }, { roll_var: "roll" }, { count_of: "models-in-bearer-unit" }, { incursion: 1, "strike-force": 2, onslaught: 3 }]) {
      const result = effectToBuffs(grant(value), own, shooting);
      expect(result.applied).toEqual([]);
      expect(result.unsupported[0].reason).toBe("weapon-ability-grant: keyword rating quantity is unresolved");
    }
    for (const value of [2, "D3"]) {
      const result = effectToBuffs(grant(value), own, shooting);
      expect(result.unsupported).toEqual([]);
      expect(result.applied[0].contribution).toEqual({ type: "extra-keyword", keywordRef: { keyword_id: "sustained-hits", parameters: { value } } });
    }
    const blast = effectToBuffs({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "blast" }] } }, own, shooting);
    expect(blast.applied[0].contribution).toEqual({ type: "extra-keyword", keywordRef: { keyword_id: "blast" } });
  });
});

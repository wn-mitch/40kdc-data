import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";

const COMMON = "https://40kdc.dev/schemas/defs/common.schema.json";
const CONDITION = "https://40kdc.dev/schemas/enrichment/ability-dsl/condition.schema.json";
const SCOPE = "https://40kdc.dev/schemas/enrichment/ability-dsl/scope.schema.json";
const WEAPON = "https://40kdc.dev/schemas/core/weapon.schema.json";

describe("Velochy shared schema contracts", () => {
  const ajv = createValidator();
  const common = <T>(name: string) => ajv.getSchema(`${COMMON}#/$defs/${name}`) as ((value: T) => boolean);
  const condition = ajv.getSchema(CONDITION)!;

  it("requires attachment roles to describe actual model membership", () => {
    const filter = common<unknown>("unit-filter");
    expect(filter({ level: "model", member_of: "this-unit", attachment_role: "bodyguard" })).toBe(true);
    expect(filter({ member_of: "this-unit" })).toBe(true);
    expect(filter({ level: "model", attachment_role: "leader" })).toBe(false);
    expect(filter({ level: "unit", unit_ids: ["pathfinder-team", "stealth-battlesuits"] })).toBe(true);
    expect(filter({ unit_ids: ["pathfinder-team"] })).toBe(false);
    expect(filter({ level: "model", unit_ids: ["pathfinder-team"] })).toBe(false);
  });

  it("exposes structured activation events and shared selection allowances", () => {
    expect(common<unknown>("game-event")("army-selected")).toBe(true);
    expect(common<unknown>("game-event")("battle-started")).toBe(true);
    const limit = common<unknown>("selection-limit");
    expect(limit({ count: 1, period: "battle-round" })).toBe(true);
    expect(limit({ count: 0, period: "battle" })).toBe(false);
    const namedAbility = common<unknown>("named-ability-ref");
    expect(namedAbility({ ability_id: "knightly-oath", definition_id: "hostile" })).toBe(true);
    expect(namedAbility({ ability_id: "knightly-oath" })).toBe(false);
  });

  it("keeps static keyword predicates separate from runtime matches", () => {
    const predicate = common<unknown>("keyword-predicate");
    expect(predicate({ required_keywords: ["INFANTRY"] })).toBe(false);
    expect(predicate({ all_of: ["INFANTRY"], none_of: ["MONSTER"] })).toBe(true);
    expect(predicate({})).toBe(true);

    expect(condition({ type: "matches", parameters: { filter: { owner: "friendly", all_of: ["INFANTRY"] } } })).toBe(true);
    expect(condition({ type: "owned-by", parameters: { owner: "friendly" } })).toBe(false);
    expect(condition({ type: "has-keyword", parameters: { all_of: ["INFANTRY"] } })).toBe(false);
    expect(condition({ type: "has-keyword", parameters: { chosen_by: "chosen-keyword" } })).toBe(true);
    expect(condition({ type: "army-state", parameters: { owner: "friendly", state: "honoured" } })).toBe(true);
    expect(condition({ type: "army-state", parameters: { owner: "friendly", state: "HONOURED" } })).toBe(false);
    expect(condition({ type: "oath-state", parameters: { ability: "knightly-oath", state: "fulfilled" } })).toBe(true);
    expect(condition({ type: "equipped-weapon-count", parameters: { subject: "this-model", weapons: { type: "melee", exclude_name: "Bolt Rifle" }, count: { min: 1, max: 1 } } })).toBe(true);
    expect(condition({ type: "equipped-weapon-count", parameters: { subject: "this-model", weapon_type: "melee", other_than: "Bolt Rifle", count: 1 } })).toBe(false);
  });

  it("retains parameterized condition atoms but rejects ordinary duplicate spellings", () => {
    expect(condition({ type: "unit-state", parameters: { state: "engaged" } })).toBe(false);
    expect(condition({ type: "unit-state", parameters: { state: "engaged", with: "defender" } })).toBe(true);
    expect(condition({ type: "unit-state", parameters: { state: "engaged", at: "phase-start" } })).toBe(true);
    expect(condition({ type: "within", parameters: { of: "defender", range: { inches: 6 } } })).toBe(false);
    expect(condition({ type: "within", parameters: { of: "defender", range: { inches: 6 }, models: "every" } })).toBe(true);
    expect(condition({ type: "visible", parameters: { to: "attacker" } })).toBe(false);
    expect(condition({ type: "visible", parameters: { to: "attacker", fully: true } })).toBe(true);
    expect(condition({ type: "designated", parameters: { tag: "spotted" } })).toBe(false);
    expect(condition({ type: "named-weapon", parameters: { subject: "this-unit", name: "Bolt Rifle", count: 1, models: { count: { min: 1 }, state: "carry" } } })).toBe(true);
    expect(condition({ type: "named-weapon", parameters: { subject: "this-unit", name: "Bolt Rifle", count: 1, models: { at_least: 1, state: "carry" } } })).toBe(false);
    expect(condition({ type: "unit-wargear", parameters: { subject: "this-unit", wargear: "teleport-homer", models: { count: { min: 1 }, state: "carry" } } })).toBe(true);

  });
  it("uses typed control comparisons and marker proximity", () => {
    expect(condition({
      type: "controls",
      parameters: {
        by: "friendly",
        objective: { role: "central" },
        compare: { owner: "enemy", comparison: "gt" },
      },
    })).toBe(true);
    expect(condition({
      type: "controls",
      parameters: {
        by: "friendly",
        proportion: { comparison: "gte", fraction: 0.5 },
      },
    })).toBe(true);
    expect(condition({ type: "controls", parameters: { compare: "more-than-opponent" } })).toBe(false);
    expect(condition({
      type: "operation-markers",
      parameters: {
        within: { of: { objective: { home_of: "enemy" } }, range: "objective-control" },
      },
    })).toBe(true);
    expect(condition({ type: "operation-markers", parameters: { side: "enemy" } })).toBe(true);
    expect(condition({ type: "operation-markers", parameters: { side: "opponent" } })).toBe(false);
    expect(condition({ type: "operation-markers", parameters: { within_range_of: "opponent-home-objective" } })).toBe(false);
  });

  it("forbids nested range tiers and preserves the complete scalar vocabulary", () => {
    const range = common<unknown>("range-ref");
    expect(range({ per_battle_round: [{ inches: 3 }, { inches: 6 }, "objective-control"] })).toBe(true);
    expect(range({ per_battle_round: [] })).toBe(false);
    expect(range({ per_battle_round: [{ per_battle_round: [{ inches: 3 }] }] })).toBe(false);
    const countOf = common<unknown>("count-of");
    expect(countOf({ count_of: "enemy-models-in-range", within: { inches: 6 } })).toBe(true);
    expect(countOf({ count_of: "enemy-models-in-range", within_inches: 6 })).toBe(false);
    const quantity = common<unknown>("quantity");
    expect(quantity(3)).toBe(true);
    expect(quantity("D8+2")).toBe(true);
    expect(quantity("D6+1")).toBe(true);
    expect(quantity("3")).toBe(false);
    expect(common<unknown>("movement-kind")("pulse-jet")).toBe(true);
    expect(common<unknown>("roll-selector")("all")).toBe(true);
    expect(common<unknown>("stat")("psyker-level")).toBe(true);
  });

  it("shares structured weapon references and scope", () => {
    const keyword = common<unknown>("weapon-keyword-ref");
    const scope = common<unknown>("weapon-scope");
    expect(keyword({ keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4 } })).toBe(true);
    expect(keyword({ keyword_id: "blast", parameters: { threshold: 1 } })).toBe(false);
    expect(scope({ keyword: { keyword_id: "anti" }, exclude_name: "not-this" })).toBe(true);
    expect(scope({ keyword: [{ keyword_id: "anti" }, { keyword_id: "blast" }], exclude_keyword: { keyword_id: "sustained-hits" } })).toBe(true);
    expect(scope({ keyword: [] })).toBe(false);
    expect(scope({ keyword: "anti" })).toBe(false);

    const weapon = ajv.getSchema(WEAPON)!;
    expect(weapon({
      id: "test-weapon",
      name: "Test Weapon",
      type: "ranged",
      profiles: [{ name: "Default", range: 24, stats: { A: 2, S: 4, AP: 0, D: 1 }, keywords: [{ keyword_id: "blast" }] }],
      game_version: { edition: "11th", dataslate: "launch" },
    })).toBe(true);
  });

  it("adds explicit lifetime vocabulary", () => {
    const scope = ajv.getSchema(SCOPE)!;
    expect(scope({ duration: "while-leading" })).toBe(true);
    expect(scope({ duration: "after-resolving" })).toBe(true);
    expect(scope({ duration: "one-use" })).toBe(true);
    expect(scope({ duration: "until-start-next-turn" })).toBe(true);
    expect(scope({ duration: "battle-end" })).toBe(false);
  });
});

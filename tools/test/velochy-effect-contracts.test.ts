import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";

const COMMON = "https://40kdc.dev/schemas/defs/common.schema.json";
const CONDITION = "https://40kdc.dev/schemas/enrichment/ability-dsl/condition.schema.json";
const SCOPE = "https://40kdc.dev/schemas/enrichment/ability-dsl/scope.schema.json";
const WEAPON = "https://40kdc.dev/schemas/core/weapon.schema.json";

const effectId =
  "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json";

const bodyguardFilter = {
  level: "model",
  member_of: "this-unit",
  attachment_role: "bodyguard",
  all_of: ["INFANTRY"],
};

const unitSelector = {
  filter: bodyguardFilter,
  count: { min: 1, max: 1 },
  limit: { count: 1, period: "battle-round" },
  bind_as: "bodyguards",
};

const validator = () => createValidator().getSchema(effectId)!;

function expectValid(effect: unknown) {
  const validate = validator();
  expect(validate(effect), JSON.stringify(validate.errors, null, 2)).toBe(true);
}

function expectInvalid(effect: unknown) {
  const validate = validator();
  expect(validate(effect)).toBe(false);
}

describe("Velochy effect contracts", () => {
  it("uses shared selectors and typed persistent selections", () => {
    expectValid({
      type: "select-units",
      selector: unitSelector,
      effect: {
        type: "stat-modifier",
        target: "selected-unit",
        modifier: { stat: "T", operation: "add", value: 1 },
      },
    });

    expectValid({
      type: "persistent-designation",
      designation: "marked",
      select: {
        kind: "unit",
        selector: {
          filter: { owner: "enemy", all_of: ["MONSTER"] },
          count: { min: 1, max: 1 },
          bind_as: "marked-unit",
        },
      },
      selection_policy: "one-time",
      consumer: {
        relation: "attacks-selected-unit",
        beneficiary: "this-model",
        effect: {
          type: "roll-modifier",
          target: "this-unit",
          modifier: { roll: "hit", operation: "add", value: 1 },
        },
      },
      duration: "battle",
    });

    expectValid({
      type: "persistent-designation",
      operation: "replace",
      designation: "marked",
      select: {
        kind: "unit",
        selector: {
          filter: { owner: "enemy", all_of: ["MONSTER"] },
          count: { min: 1, max: 1 },
          bind_as: "marked-unit",
        },
      },
      selection_policy: "replace-on-destroyed",
      duration: "battle",
      lifecycle: {
        replace: {
          event: "on-unit-destroyed",
          reference: { selection_var: "marked-unit" },
          optional: true,
        },
        exclusivity: "one-active-per-bearer-unit",
      },
    });
    expectValid({
      type: "ability-modifier",
      target: "this-unit",
      modifier: {
        ability: { event: "used", event_var: "used-ability" },
        aspect: "selection",
        operation: "set",
        selection: {
          filter: { owner: "friendly", all_of: ["INFANTRY"] },
          count: { min: 1, max: 1 },
        },
        recipient_duration: "battle",
      },
    });
    expectInvalid({
      type: "ability-modifier",
      target: "this-unit",
      modifier: {
        ability: { event: "used" },
        aspect: "selection",
        operation: "set",
        selection: { filter: { owner: "friendly" } },
        recipient_duration: "battle",
      },
    });
  });

  it("rejects retired selector and leader-wrapper spellings", () => {
    expectInvalid({
      type: "select-units",
      selector: { owner: "friendly", count: 1, keywords: ["INFANTRY"] },
      effect: { type: "no-effect" },
    });
    expectInvalid({
      type: "leader-model-ability-grant",
      source: "bearer-unit",
      beneficiary: "leading-leader-model",
      attached_unit_filter: null,
      duration: "while-leading",
      grant: { recipient: "beneficiary", effect: { type: "no-effect" } },
      recipient_binding: "beneficiary-only",
    });
  });

  it("requires stable stance option identities and typed capacity links", () => {
    expectValid({
      type: "stance-select",
      mode: "consumable",
      options: [
        { id: "assault", name: "Assault", effect: { type: "no-effect" } },
        { id: "tactical", name: "Tactical", effect: { type: "no-effect" } },
      ],
      min_choices: 0,
      max_choices: 1,
    });
    expectValid({
      type: "stance-selection-capacity",
      modifier: {
        ability_id: "combat-doctrines", // mfm:mirror keep — a fixture id
        additional_selections: 1,
        allocation: "fixed-option",
        option: { ability_id: "combat-doctrines", option_id: "assault" }, // mfm:mirror keep — a fixture id
      },
    });
    expectInvalid({
      type: "stance-select",
      mode: "consumable",
      scope: "unit",
      select: "battle-round-start",
      options: [
        { name: "Assault", effect: { type: "no-effect" } },
        { name: "Tactical", effect: { type: "no-effect" } },
      ],
    });
  });

  it("uses structured weapon scopes, keyword grants and range adjustments", () => {
    expectValid({
      type: "weapon-ability-grant",
      target: "this-unit",
      modifier: {
        keywords: [
          { keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4 } },
          { keyword_id: "blast", parameters: { value: 1 } },
        ],
        weapons: { type: "ranged", exclude_name: "Pistol" },
      },
    });
    expectValid({
      type: "weapon-ability-range",
      target: "this-unit",
      modifier: {
        keyword: { keyword_id: "rapid-fire" },
        range: { inches: 12 },
      },
    });
    expectInvalid({
      type: "weapon-ability-grant",
      target: "this-unit",
      modifier: { abilities: ["Anti"], weapon_type: "ranged" },
    });
  });

  it("closes compositions and keeps choice bounds meaningful", () => {
    expectValid({
      type: "choice",
      min_choices: 0,
      max_choices: 2,
      options: [
        { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } },
        { type: "stat-modifier", target: "this-unit", modifier: { stat: "T", operation: "add", value: 1 } },
      ],
    });

    expectValid({
      type: "dice-pool-allocation",
      pool: { count: 2, die: "D6" },
      max_activations: 1,
      options: [
        {
          id: "unbridled-bloodlust",
          name: "Unbridled Bloodlust",
          requirement: { type: "pair", min_value: 1 },
          effect: { type: "no-effect" },
        },
      ],
    });
    expectInvalid({
      type: "sequence",
      steps: [{ type: "no-effect" }],
      hidden: true,
    });
    expectInvalid({
      type: "conditional",
      condition: { type: "owned-by", parameters: { owner: "friendly" } },
      effect: { type: "no-effect" },
      hidden: true,
    });
  });

  it("requires a typed act-on-death gate and parameterized named regions", () => {
    expectValid({
      type: "act-on-death",
      target: "this-unit",
      modifier: {
        act: "fight",
        gate: {
          dice: "2D6",
          comparison: "gte",
          threshold: 4,
          modifiers: [{ condition: { type: "phase-is", parameters: { phase: "command" } }, value: 1 }],
        },
        resolution: "after-destroyed",
        removal: "after-fight",
      },
    });
    expectInvalid({
      type: "act-on-death",
      target: "this-unit",
      modifier: { act: "fight", gate: { typo: true } },
    });

    expectValid({
      type: "named-region-state",
      modifier: {
        region_ref: { region_id: "hallowed-ground", owner_faction: "test-faction" },
        producer: {
          region_ref: { region_id: "hallowed-ground", owner_faction: "test-faction" },
          mode: "complete",
          parent_ref: null,
          baseline: [{ region: { territory: "your-territory" }, duration: "permanent" }],
          phase_extensions: [{
            region: { territory: "no-mans-land" },
            condition: { type: "phase-is", parameters: { phase: "command" } },
            trigger: { event: "phase-started", condition: { type: "phase-is", parameters: { phase: "command" } } },
            duration: "phase",
            evaluation: "snapshot-once",
          }],
          additive_extensions: [],
        },
        consumer: {
          state_ref: { region_id: "hallowed-ground", owner_faction: "test-faction" },
          beneficiary_filter: { owner: "friendly", all_of: ["INFANTRY"] },
          membership: { unit_scope: "whole-unit", relation: "within-region" },
          qualified_condition: { type: "matches", parameters: { subject: "this-unit", filter: { owner: "friendly" } } },
          default_branch: { effect: { type: "ability-part", effect: { type: "no-effect" } } },
          qualified_branch: { effect: { type: "ability-part", effect: { type: "no-effect" } } },
        },
        branch_precedence: "qualified-replaces-default",
      },
    });
    expectInvalid({
      type: "named-region-state",
      modifier: {
        region_ref: { region_id: "hallowed-ground", owner_faction: "test-faction" },
        producer: {
          region_ref: { region_id: "hallowed-ground", owner_faction: "test-faction" },
          mode: "complete",
          parent_ref: null,
          baseline: [{ kind: "fixed-zone", zone: "own-deployment-zone", activation: { event: "always-active" }, expiry: { event: "never" } }],
          phase_extensions: [], additive_extensions: [],
        },
        consumer: {
          state_ref: { rule_region: { region_id: "hallowed-ground", owner_faction: "test-faction" } },
          beneficiary_gate: { owner: "friendly", operator: "and", keywords: ["INFANTRY"] },
          membership: { unit_scope: "whole-unit", relation: "within-region" },
          qualified_condition: { type: "controls", parameters: { owner: "friendly" } },
          default_branch: { effect: { type: "ability-part", effect: { type: "no-effect" } } },
          qualified_branch: { effect: { type: "ability-part", effect: { type: "no-effect" } } },
        },
        branch_precedence: "qualified-replaces-default",
      },
    });
  });
});

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

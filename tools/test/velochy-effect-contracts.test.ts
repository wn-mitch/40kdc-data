import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";

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

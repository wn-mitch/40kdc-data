import { describe, expect, it } from "vitest";
import { transformEffects } from "../src/round6/vocab-cutover-effects.js";
import type { CutoverContext, Node } from "../src/round6/vocab-cutover-types.js";

function run(input: Node): { node: Node; reports: string[] } {
  const reports: string[] = [];
  const ctx: CutoverContext = {
    file: "fixture.json",
    record: "fixture",
    pointer: "/effect",
    report: (reason) => reports.push(reason),
  };
  return { node: transformEffects(input, ctx), reports };
}

describe("round-6 effect vocabulary cutover", () => {
  it("converts catalog-backed weapon grants and their shared weapon scope", () => {
    const result = run({
      type: "weapon-ability-grant",
      target: "unit",
      modifier: { abilities: ["Anti-INFANTRY 4+", "Sustained Hits 1"], weapon_type: "ranged", weapon_name: "Boltgun" },
    });
    expect(result.reports).toEqual([]);
    expect(result.node).toEqual({
      type: "weapon-ability-grant",
      target: "this-unit",
      modifier: {
        keywords: [
          { keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4 } },
          { keyword_id: "sustained-hits", parameters: { value: 1 } },
        ],
        weapons: { type: "ranged", name: "Boltgun" },
      },
    });
  });

  it("moves bodyguard and model-keyword restrictions to a canonical model target", () => {
    const result = run({
      type: "return-models",
      target: "selected-unit",
      modifier: { count: 1, bodyguard_only: true, model_keyword: "HERO" },
    });
    expect(result.reports).toEqual([]);
    expect(result.node).toEqual({
      type: "return-models",
      target: { level: "model", member_of: "selected-unit", attachment_role: "bodyguard", all_of: ["HERO"] },
      modifier: { count: 1 },
    });
  });

  it("turns a beneficiary-only leader grant into an ordinary inline ability grant", () => {
    const result = run({
      type: "leader-model-ability-grant",
      source: "bearer-unit",
      beneficiary: "leading-leader-model",
      recipient_binding: "beneficiary-only",
      duration: "while-leading",
      leader_filter: { keywords: ["MINISTORUM PRIEST"] },
      attached_unit_filter: null,
      grant: { recipient: "beneficiary", effect: { type: "feel-no-pain", modifier: { threshold: 5 } } },
    });
    expect(result.reports).toEqual([]);
    expect(result.node).toEqual({
      type: "ability-grant",
      target: { level: "model", member_of: "this-unit", attachment_role: "leader", all_of: ["MINISTORUM PRIEST"] },
      modifier: {
        definition: {
          type: "ability-part",
          duration: "while-leading",
          effect: { type: "feel-no-pain", target: "this-model", modifier: { threshold: 5 } },
        },
      },
    });
  });

  it("lowers conditional on_fail to complementary branches", () => {
    const result = run({
      type: "conditional",
      condition: { type: "controls" },
      effect: { type: "state-change", target: "unit", modifier: { state: "hidden", set: true } },
      on_fail: { type: "state-change", target: "unit", modifier: { state: "hidden", set: false } },
    });
    expect(result.reports).toEqual([]);
    expect(result.node).toEqual({
      type: "sequence",
      steps: [
        {
          type: "conditional",
          condition: { type: "controls" },
          effect: { type: "state-change", target: "unit", modifier: { state: "hidden", set: true } },
        },
        {
          type: "conditional",
          condition: { operator: "not", operands: [{ type: "controls" }] },
          effect: { type: "state-change", target: "unit", modifier: { state: "hidden", set: false } },
        },
      ],
    });
  });

  it("parameterizes named-region producer and consumer recipes", () => {
    const result = run({
      type: "named-region-state",
      target: { owner: "friendly" },
      modifier: {
        region_ref: { region_id: "fabricated-region", owner_faction: "fabricated-faction" },
        producer: {
          region_ref: { region_id: "fabricated-region", owner_faction: "fabricated-faction" },
          mode: "complete",
          parent_ref: null,
          baseline: [{ kind: "fixed-zone", zone: "own-deployment-zone", activation: { event: "always-active" }, expiry: { event: "never" } }],
          phase_extensions: [{ kind: "objective-majority-zone", zone: "no-mans-land", control_gate: { controlled_by: "owner-army", threshold: { comparison: "at-least", fraction: 0.75 } }, activation: { event: "phase-start", evaluation: "snapshot-once" }, expiry: { event: "phase-end" } }],
          additive_extensions: [],
        },
        consumer: {
          state_ref: { region_id: "fabricated-region", owner_faction: "fabricated-faction" },
          beneficiary_gate: { owner: "owner-army", operator: "and", keywords: ["FABRICATED"] },
          membership: { unit_scope: "model", relation: "wholly-within" },
          qualified_condition: { type: "in-region" },
          default_branch: { effect: { type: "re-roll", target: "attacker", modifier: { roll: "hit" } }, optional: false, duration: "attack-resolution" },
          qualified_branch: { effect: { type: "roll-modifier", target: "attacker", modifier: { roll: "wound", operation: "add", value: 1 } }, optional: true, duration: "attack-resolution" },
        },
        branch_precedence: "qualified-replaces-default",
      },
    });
    expect(result.reports).toEqual([]);
    const modifier = result.node.modifier as Node;
    const producer = modifier.producer as Node;
    expect((producer.baseline as Node[])[0]).toEqual({ region: { territory: "your-deployment-zone" }, duration: "permanent" });
    expect((producer.phase_extensions as Node[])[0]).toMatchObject({
      region: { territory: "no-mans-land" },
      condition: { type: "controls", parameters: { by: "friendly", proportion: { comparison: "gte", fraction: 0.75 } } },
      trigger: { event: "phase-started" }, duration: "phase", evaluation: "snapshot-once",
    });
    const consumer = modifier.consumer as Node;
    expect(consumer.beneficiary_filter).toEqual({ owner: "friendly", all_of: ["FABRICATED"] });
    expect((consumer.default_branch as Node).effect).toMatchObject({ type: "ability-part", duration: "resolution" });
  });

  it("normalizes effect distances, scaling distances, selector counts, and choice metadata", () => {
    const choice = run({ type: "choice", choice_prompt: "Choose", min_choices: 0, max_choices: 2, options: [] });
    expect(choice.reports).toEqual([]);
    expect(choice.node.choice_prompt).toBe("Choose");
    expect(choice.node.min_choices).toBe(0);
    expect(choice.node.max_choices).toBe(2);

    const selection = run({ type: "select-units", selector: { owner: "enemy", max_count: 1, within_inches: 6 }, effect: { type: "no-effect" } });
    expect(selection.reports).toEqual([]);
    expect(selection.node.selector).toEqual({ owner: "enemy", count: { min: 0, max: 1 }, within_inches: 6 });

    const scaled = run({
      type: "stat-modifier",
      target: "unit",
      modifier: { stat: "M", operation: "add", value: 1, range_inches: 3 },
      scaling: { per: 1, of: "enemy-units-in-range", within_inches: 9 },
    });
    expect(scaled.reports).toEqual([]);
    expect(scaled.node.modifier).toEqual({ stat: "M", operation: "add", value: 1, range: { inches: 3 } });
    expect(scaled.node.scaling).toEqual({ per: 1, of: "enemy-units-in-range", within: { inches: 9 } });
  });

  it("preserves an unknown weapon grant while reporting it", () => {
    const input: Node = { type: "weapon-ability-grant", target: "unit", modifier: { abilities: ["Invented Hits"] } };
    const result = run(input);
    expect(result.reports).toHaveLength(1);
    expect(result.node).toEqual({ type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Invented Hits"] } });
  });
});

import { describe, expect, it } from "vitest";
import { describeAbility, describeScope } from "../src/translate/index.js";

const render = (effect: unknown): string => describeAbility({ effect } as Parameters<typeof describeAbility>[0]);

describe("canonical leaf consumers", () => {
  it("renders catalog parameters and removals without parsing DSL strings", () => {
    const text = render({ type: "weapon-ability-grant", target: "this-model", modifier: {
      weapons: { type: "ranged" },
      keywords: [{ keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4 } }, { keyword_id: "blast", parameters: { value: 1 } }],
      removes: [{ keyword_id: "rapid-fire" }],
    } });
    expect(text).toBe("Ranged weapons equipped by this model gain [ANTI-INFANTRY 4+] and [BLAST 1] and lose [RAPID FIRE].");
    expect(text).not.toContain("OBJECT");
  });

  it("renders conjunctive structured keyword target guards", () => {
    const text = render({ type: "weapon-ability-grant", target: "this-model", modifier: {
      keywords: [{ keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4, required_target_keywords_any: ["VEHICLE", "MONSTER"], excluded_target_keywords: ["TITANIC"] } }],
    } });
    expect(text).toContain("[ANTI-INFANTRY 4+] (against VEHICLE or MONSTER units) (excluding TITANIC units)");
  });

  it("preserves shared weapon name and keyword exclusions", () => {
    const text = render({ type: "stat-modifier", target: "this-model", modifier: {
      stat: "S", operation: "add", value: 1,
      weapons: { type: "melee", exclude_name: "Practice blade", keyword: [{ keyword_id: "lethal-hits" }, { keyword_id: "sustained-hits" }], exclude_keyword: { keyword_id: "one-shot" } },
    } });
    expect(text).toContain('melee weapons with [LETHAL HITS] or [SUSTAINED HITS] other than "Practice blade" (excluding weapons with [ONE SHOT])');
  });

  it("names actual Bodyguard membership on return and destruction", () => {
    const target = { level: "model", member_of: "selected-unit", attachment_role: "bodyguard", all_of: ["CHARACTER"] };
    expect(render({ type: "return-models", target, modifier: { count: 1, wounds_remaining: "full" } })).toBe("Return 1 destroyed CHARACTER Bodyguard model to the selected unit, each with its full wounds remaining.");
    expect(render({ type: "destroy-models", target, modifier: { count: 1 } })).toBe("Destroy 1 of the CHARACTER Bodyguard models in the selected unit.");
  });

  it("keeps inline ability grants on the model recipients", () => {
    const text = render({ type: "ability-grant", target: { level: "model", member_of: "this-unit", attachment_role: "leader" }, modifier: {
      definition: { type: "ability-part", name: "Practice ward", effect: { type: "feel-no-pain", target: "this-model", modifier: { threshold: 5 } } },
    } });
    expect(text).toContain("Leader models in the unit gain the Practice ward ability");
    expect(text).not.toContain("Units with one or more");
  });

  it("modifies an existing keyword's supplied range without inventing its rating", () => {
    const text = render({ type: "weapon-ability-range", target: "this-unit", modifier: { keyword: { keyword_id: "rapid-fire" }, range: { inches: 18 } } });
    expect(text).toBe('The unit\'s attacks benefit from [RAPID FIRE] when the target is within 18".');
    expect(text).not.toContain("gain");
  });

  it("renders range refs for setup and marker relocation", () => {
    expect(render({ type: "set-up", target: "this-unit", modifier: { from: "strategic-reserves", min_enemy_distance: { inches: 9 }, within_edge: { inches: 6 } } })).toBe('The unit can be set up on the battlefield from Strategic Reserves wholly within 6" of a battlefield edge more than 9" away from all enemy models.');
    expect(render({ type: "marker", target: "this-unit", modifier: { operation: "relocate", label: "practice", distance: { inches: 6 } } })).toBe('Move the practice marker up to 6".');
  });

  it("renders canonical scaling reach and duration-only scope", () => {
    const text = render({ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 }, scaling: { per: 1, of: "enemy-models-in-range", within: { inches: 3 } } });
    expect(text).toContain('within 3"');
    expect(text.match(/within 3"/g)).toHaveLength(1);
    expect(describeScope({ duration: "while-leading" })).toBe("Duration: while this model is leading a unit.");
    expect(describeScope({ duration: "after-resolving" })).toBe("Duration: after resolving this use.");
  });

  it("retains conditional death-roll bonuses, resolution and removal ordering", () => {
    const text = render({ type: "act-on-death", target: "this-model", modifier: {
      act: "fight", resolution: "after-attacking-unit-finishes", removal: "after-destroyed-model-fights",
      eligibility: { type: "matches", parameters: { subject: "this-model", filter: { all_of: ["INFANTRY"] } } },
      gate: { dice: "D6", comparison: "gte", threshold: 4, modifiers: [{ value: 1, condition: { type: "phase-is", parameters: { phase: "fight" } } }] },
    } });
    expect(text).toContain("adding 1");
    expect(text).toContain("INFANTRY");
    expect(text).toContain("after the attacking unit has finished making its attacks, it can fight");
    expect(text).toContain("Remove it after it has fought");
  });
});

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function effectOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

const rangedAttack = (wording: string): [string, string, Record<string, unknown>] => [wording, "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }];

describe("Semantic authoring properties of an attack with conditions on its target", () => {
  it("grants keywords after an attack and its target filter to the attack, gated on the target", () => {
    const text = "This unit's ranged attacks that target an enemy MONSTER unit have [SUSTAINED HITS 1].";
    const effect = effectOf(placed(text,
      rangedAttack("This unit's ranged attacks"),
      ["enemy MONSTER unit", "unit-filter", { side: "enemy", keywords: ["MONSTER"] }],
      ["SUSTAINED HITS 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }]), text);
    expect(effect.type).toBe("conditional");
    expect(effect.condition).toMatchObject({ type: "matches", parameters: { subject: "defender", filter: { all_of: ["MONSTER"] } } });
    expect(effect.effect).toEqual({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }], weapons: { type: "ranged" } } });
  });

  it("reads list punctuation between properties as one list, and gives an unowned stat to the attack", () => {
    const text = "This unit's melee attacks have:+1 S.[LETHAL HITS].[PRECISION].";
    const effect = effectOf(placed(text,
      ["This unit's melee attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["+1 S", "characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 1 }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }]), text);
    expect(effect).toEqual({ type: "sequence", steps: [
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "improve", value: 1, weapons: { type: "melee" } } },
      { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }, { keyword_id: "precision" }], weapons: { type: "melee" } } },
    ] });
  });

  it("does not let a framed attack's melee/ranged gate reach the next sentence", () => {
    const text = "When a friendly ALPHA unit is selected to Advance: that unit's ranged attacks have [ASSAULT]. That unit is eligible to declare a charge.";
    const effect = effectOf(placed(text,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["is selected to Advance", "event", { kind: "selected", to: "move", move_types: ["advance"] }],
      ["that unit's ranged attacks", "attack", { direction: "makes", unit: "that-unit", attack_type: "ranged" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
      ["That unit is eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true }]), text);
    expect(JSON.stringify(effect)).not.toContain("attack-is");
    expect(effect.steps[0]).toMatchObject({ type: "weapon-ability-grant", target: "event-subject" });
    expect(effect.steps[1]).toMatchObject({ type: "permission", target: "event-subject" });
  });

  it("folds a target filter that follows the weapon the attack is made with", () => {
    const text = "Each time this model makes an attack with its plasma lance that targets a VEHICLE unit, add 1 to the Wound roll.";
    const effect = effectOf(placed(text,
      ["Each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["with its plasma lance", "attack-filter", { weapon_name: "plasma lance" }],
      ["VEHICLE unit", "unit-filter", { side: "enemy", keywords: ["VEHICLE"] }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]), text);
    expect(JSON.stringify(effect.condition)).toContain('"weapons":{"name":"plasma lance"}');
    expect(JSON.stringify(effect.condition)).toContain('"subject":"defender","filter":{"all_of":["VEHICLE"]}');
  });

  it("lets a filter's units' attack scope take a target gate and a duration before its properties", () => {
    const text = "Select one enemy unit within 12\" of this unit. Friendly ALPHA units' attacks that target that unit, until the end of the phase, have [LETHAL HITS].";
    const result = compileLeaves(placed(text,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["within 12\" of this unit", "unit-position", { kind: "within", inches: 12, of: "this-unit", subject: "antecedent", negated: false }],
      ["Friendly ALPHA units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["attacks", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
      ["that target that unit", "target-is-selected", {}],
      ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const json = JSON.stringify(result.mechanics);
    expect(json).toContain('"all_of":["ALPHA"]');
    expect(json).toContain('"keyword_id":"lethal-hits"');
    expect((result.mechanics as unknown as Record<string, any>).scope.duration).toBe("phase");
  });
});

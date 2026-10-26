import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { bindFrameAntecedents } from "../src/semantic-authoring/compile-weapon-antecedent.js";
import { shapeSignature } from "../src/semantic-authoring/compile-placement.js";

/**
 * Antecedent frames and target-qualified keywords on "Or:" branches. Fabricated wording only.
 * An item with "zero" is a zero-width leaf at the first byte of its wording (a frame that
 * precedes the leaf it grants).
 */
type Item = [string, string, Record<string, unknown>, ("zero" | undefined)?];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, zero]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = zero ? start : start + Buffer.byteLength(wording, "utf8");
    if (!zero) from = end;
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, leaves: CompileLeaf[]): Record<string, any> {
  const result = compileLeaves(leaves, text, {});
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

const frame = (wording: string, weaponType: string): Item => [wording, "weapon-ability-grant", { subject: "this-unit", weapon_type: weaponType }];
const keyword = (wording: string, name: string): Item => [wording, "weapon-ability-keyword", { keyword: name }];
const antecedentFrame = (wording: string): Item => [wording, "weapon-ability-grant", { frame: "antecedent" }, "zero"];
const notMonsterVehicle: Item = ["non-MONSTER/VEHICLE", "unit-filter", { side: "any", excluded_keywords: ["MONSTER", "VEHICLE"] }];
const monsterVehicle: Item = ["MONSTER/VEHICLE**", "unit-filter", { side: "any", any_keywords: ["MONSTER", "VEHICLE"] }];

describe("Semantic authoring antecedent frames on an Or: branch", () => {
  it("SS-1: a menu's third option takes its weapons from the frame before the branch", () => {
    const text = "Your unit's attacks have [LETHAL HITS] or [SUSTAINED HITS 1]. Or: If your unit is entrenched, [LETHAL HITS] and [SUSTAINED HITS 1].";
    const effect = compiled(text, placed(text,
      frame("Your unit's attacks", "all"),
      keyword("LETHAL HITS", "Lethal Hits"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      ["If your unit is entrenched", "rule-active", { rule: "example-rule" }],
      antecedentFrame("LETHAL HITS"),
      keyword("LETHAL HITS", "Lethal Hits"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
    ));
    expect(effect.steps[0]).toEqual({ type: "choice", options: [
      { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }] } },
      { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] } },
    ] });
    expect(effect.steps[1]).toMatchObject({
      type: "conditional",
      condition: { type: "rule-active" },
      effect: { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }, { keyword_id: "sustained-hits", parameters: { value: 1 } }] } },
    });
  });

  it("SS-1: without the antecedent frame the branch's keywords are refused", () => {
    const text = "Your unit's attacks have [LETHAL HITS] or [SUSTAINED HITS 1]. Or: If your unit is entrenched, [LETHAL HITS] and [SUSTAINED HITS 1].";
    const result = compileLeaves(placed(text,
      frame("Your unit's attacks", "all"),
      keyword("LETHAL HITS", "Lethal Hits"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      ["If your unit is entrenched", "rule-active", { rule: "example-rule" }],
      keyword("LETHAL HITS", "Lethal Hits"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
    ), text, {});
    expect(result.ok).toBe(false);
  });

  it("SS-2: an Or: branch's stat adjustment takes its weapon type from the branch's keyword frame", () => {
    const text = "Your unit's melee attacks have [LANCE]. Or: If the assault doctrine is active for your unit, [LANCE] and +1 AP.";
    const effect = compiled(text, placed(text,
      frame("Your unit's melee attacks", "melee"),
      keyword("LANCE", "Lance"),
      ["Or:", "instead", { choice: false }],
      ["If the assault doctrine is active for your unit", "rule-active", { rule: "assault-doctrine" }],
      antecedentFrame("LANCE"),
      keyword("LANCE", "Lance"),
      ["+1 AP", "weapon-property-scope", { frame: "antecedent" }, "zero"],
      ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }],
    ));
    expect(JSON.stringify(effect)).toContain('"stat":"AP","operation":"improve","value":1,"weapons":{"type":"melee"}');
    expect(JSON.stringify(effect)).toContain('"keywords":[{"keyword_id":"lance"}],"weapons":{"type":"melee"}');
  });

  it("SS-3 scope path: a qualifier with the ': **' gap gates the keyword under a scope", () => {
    const text = "Your unit's attacks have: [SUSTAINED HITS 1: **non-MONSTER/VEHICLE**].";
    const effect = compiled(text, placed(text,
      ["Your unit's attacks have", "weapon-property-scope", { subject: "this-unit", weapon_type: "all" }],
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      notMonsterVehicle,
    ));
    expect(effect.type).toBe("conditional");
    expect(effect.condition).toEqual({ type: "matches", parameters: { subject: "defender", filter: { none_of: ["MONSTER", "VEHICLE"] } } });
    expect(effect.effect).toEqual({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] } });
  });

  it("a qualifier gates only its own keyword, not the branch after it", () => {
    const text = "This unit's melee attacks have: [SUSTAINED HITS 1: **non-MONSTER/VEHICLE**]. Or: If the assault doctrine is active for your unit, [SUSTAINED HITS 1].";
    const effect = compiled(text, placed(text,
      ["This unit's melee attacks", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      notMonsterVehicle,
      ["If the assault doctrine is active for your unit", "rule-active", { rule: "assault-doctrine" }],
      antecedentFrame("SUSTAINED HITS 1"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
    ));
    expect(effect.type).toBe("sequence");
    expect(effect.steps[0]).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "defender", filter: { none_of: ["MONSTER", "VEHICLE"] } } }, effect: { type: "weapon-ability-grant" } });
    expect(effect.steps[1]).toEqual({ type: "conditional", condition: { type: "rule-active", parameters: { rule: "assault-doctrine" } },
      effect: { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }], weapons: { type: "melee" } } } });
  });

  it("SS-3 frame path: each qualified keyword of a menu is gated, and the menu is a choice of conditional options", () => {
    const text = "Your unit's attacks have: [SUSTAINED HITS 1: **non-MONSTER/VEHICLE**]. Or: [LETHAL HITS: **MONSTER/VEHICLE**].";
    const effect = compiled(text, placed(text,
      frame("Your unit's attacks", "all"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      notMonsterVehicle,
      antecedentFrame("LETHAL HITS"),
      keyword("LETHAL HITS", "Lethal Hits"),
      monsterVehicle,
    ));
    expect(effect.type).toBe("choice");
    expect(effect.options[0]).toMatchObject({ type: "conditional", effect: { modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] } } });
    expect(effect.options[0].condition).toEqual({ type: "matches", parameters: { subject: "defender", filter: { none_of: ["MONSTER", "VEHICLE"] } } });
    expect(effect.options[1]).toEqual({ type: "conditional",
      condition: { type: "matches", parameters: { subject: "defender", filter: { any_of: ["MONSTER", "VEHICLE"] } } },
      effect: { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }] } } });
  });

  it("refuses a qualifier after a keyword with a sentence break or a word in the gap", () => {
    const sentence = "Your unit's attacks have: [SUSTAINED HITS 1. **non-MONSTER/VEHICLE**]. Or: [LETHAL HITS: **MONSTER/VEHICLE**].";
    const sentenceResult = compileLeaves(placed(sentence,
      frame("Your unit's attacks", "all"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      notMonsterVehicle,
      antecedentFrame("LETHAL HITS"),
      keyword("LETHAL HITS", "Lethal Hits"),
      monsterVehicle,
    ), sentence, {});
    expect(sentenceResult.ok).toBe(false);
    const word = "Your unit's attacks have: [SUSTAINED HITS 1 and **non-MONSTER/VEHICLE**]. Or: [LETHAL HITS: **MONSTER/VEHICLE**].";
    const wordResult = compileLeaves(placed(word,
      frame("Your unit's attacks", "all"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      notMonsterVehicle,
      antecedentFrame("LETHAL HITS"),
      keyword("LETHAL HITS", "Lethal Hits"),
      monsterVehicle,
    ), word, {});
    expect(wordResult.ok).toBe(false);
  });

  it("refuses a qualifier after a run of more than one keyword", () => {
    const text = "Your unit's attacks have: [SUSTAINED HITS 1] and [LETHAL HITS: **MONSTER/VEHICLE**].";
    const result = compileLeaves(placed(text,
      frame("Your unit's attacks", "all"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      keyword("LETHAL HITS", "Lethal Hits"),
      monsterVehicle,
    ), text, {});
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("more than one keyword");
  });

  it("refuses a choice between a qualified and an unqualified keyword", () => {
    const text = "Your unit's attacks have: [SUSTAINED HITS 1: **non-MONSTER/VEHICLE**]. Or: [LETHAL HITS].";
    const result = compileLeaves(placed(text,
      frame("Your unit's attacks", "all"),
      keyword("SUSTAINED HITS 1", "Sustained Hits 1"),
      notMonsterVehicle,
      antecedentFrame("LETHAL HITS"),
      keyword("LETHAL HITS", "Lethal Hits"),
    ), text, {});
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("qualified and an unqualified");
  });

  describe("binder refusals", () => {
    const refused = (text: string, leaves: CompileLeaf[], message: string) => {
      const result = compileLeaves(leaves, text, {});
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.errors.join(" ")).toContain(message);
    };
    const branch = "Your unit's melee attacks have [LANCE]. Or: [LANCE].";

    it("refuses an antecedent grant with no earlier frame, with the existing message", () => {
      refused("Its attacks have [LANCE].", placed("Its attacks have [LANCE].", antecedentFrame("LANCE"), keyword("LANCE", "Lance")),
        "A weapon-ability-keyword leaf has no weapon-ability-grant frame saying which weapons gain it.");
    });

    it("refuses an antecedent scope with no earlier source", () => {
      const text = "Its attacks have +1 AP.";
      refused(text, placed(text, ["+1 AP", "weapon-property-scope", { frame: "antecedent" }, "zero"],
        ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }]),
        "A weapon-property-scope with no recipient needs an earlier frame to take its recipient from.");
    });

    it("refuses a trigger between the source and the antecedent", () => {
      const text = "Your unit's melee attacks have [LANCE]. When a unit is selected to fight, [LANCE].";
      refused(text, placed(text, frame("Your unit's melee attacks", "melee"), keyword("LANCE", "Lance"),
        ["When a unit is selected to fight", "event", { kind: "selected", to: "fight" }],
        antecedentFrame("LANCE"), keyword("LANCE", "Lance")), "trigger");
    });

    it("refuses a container opener between the source and the antecedent", () => {
      const text = "Your unit's melee attacks have [LANCE]. Choose one: [LANCE].";
      refused(text, placed(text, frame("Your unit's melee attacks", "melee"), keyword("LANCE", "Lance"),
        ["Choose one", "stance-select-open", { subject: "this-unit" }],
        antecedentFrame("LANCE"), keyword("LANCE", "Lance")), "container");
    });

    it("refuses a target condition between the source and the antecedent in the source's fragment", () => {
      const text = "Your unit's melee attacks have [LANCE]. That target is a marked unit, [LANCE].";
      const leaves = placed(text, frame("Your unit's melee attacks", "melee"), keyword("LANCE", "Lance"),
        ["That target is a marked unit", "unit-mark", { subject: "defender", mark: "example" }],
        antecedentFrame("LANCE"), keyword("LANCE", "Lance"));
      refused(text, leaves, "target condition or duration");
    });

    it("refuses a duration between the source and the antecedent in the source's fragment", () => {
      const text = "Your unit's melee attacks have [LANCE]. Until the end of the phase, [LANCE].";
      const leaves = placed(text, frame("Your unit's melee attacks", "melee"), keyword("LANCE", "Lance"),
        ["Until the end of the phase", "duration", { until: "end-of-phase" }],
        antecedentFrame("LANCE"), keyword("LANCE", "Lance"));
      refused(text, leaves, "target condition or duration");
    });

    it("refuses a source that names a weapon keyword, weapon name, incoming attacks or a bound weapon", () => {
      for (const extra of [{ weapon_keyword: "Melee" }, { weapon_name: "lance" }, { incoming: true }, { weapon_var: "sword" }]) {
        const leaves = placed(branch, ["Your unit's melee attacks", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee", ...extra }],
          keyword("LANCE", "Lance"), antecedentFrame("LANCE"), keyword("LANCE", "Lance"));
        refused(branch, leaves, "would widen its weapons");
      }
    });

    it("refuses an antecedent frame whose own fragment names a recipient", () => {
      const text = "Your unit's melee attacks have [LANCE]. Friendly ADEPTUS units: [LANCE].";
      const leaves = placed(text, frame("Your unit's melee attacks", "melee"), keyword("LANCE", "Lance"),
        antecedentFrame("LANCE"), ["Friendly ADEPTUS units", "unit-filter", { side: "friendly", keywords: ["ADEPTUS"] }],
        keyword("LANCE", "Lance"));
      refused(text, leaves, "cannot also inherit one");
    });

    it("does not change the shape signature", () => {
      const text = "Your unit's attacks have [LETHAL HITS] or [SUSTAINED HITS 1]. Or: If your unit is entrenched, [LETHAL HITS] and [SUSTAINED HITS 1].";
      const leaves = placed(text, frame("Your unit's attacks", "all"), keyword("LETHAL HITS", "Lethal Hits"),
        keyword("SUSTAINED HITS 1", "Sustained Hits 1"), ["If your unit is entrenched", "rule-active", { rule: "example-rule" }],
        antecedentFrame("LETHAL HITS"), keyword("LETHAL HITS", "Lethal Hits"), keyword("SUSTAINED HITS 1", "Sustained Hits 1"));
      expect(shapeSignature(bindFrameAntecedents(leaves), text)).toBe(shapeSignature(leaves, text));
    });
  });

  describe("family versions", () => {
    it("grant v10 and scope v5 take frame antecedent and nothing that names a recipient or keyword", () => {
      expect(currentFamilyVersion("weapon-ability-grant")).toBe(10);
      // Version 5 is the frame-antecedent widening; later widenings (weapon_names) stack on it.
      expect(currentFamilyVersion("weapon-property-scope")).toBeGreaterThanOrEqual(5);
      expect(normalizeFingerprintParameters("weapon-ability-grant", { frame: "antecedent" }, 10)).toEqual({ frame: "antecedent" });
      expect(normalizeFingerprintParameters("weapon-property-scope", { frame: "antecedent" }, 5)).toEqual({ frame: "antecedent" });
      expect(() => normalizeFingerprintParameters("weapon-ability-grant", { frame: "antecedent", keyword: "Lance" }, 10)).toThrow(TypeError);
      expect(() => normalizeFingerprintParameters("weapon-ability-grant", { frame: "antecedent", subject: "this-unit" }, 10)).toThrow(TypeError);
      expect(() => normalizeFingerprintParameters("weapon-property-scope", { frame: "antecedent", subject: "this-unit" }, 5)).toThrow(TypeError);
      expect(() => normalizeFingerprintParameters("weapon-property-scope", { frame: "antecedent", weapon_name: "lance" }, 5)).toThrow(TypeError);
    });

    it("earlier versions take no frame key", () => {
      expect(() => normalizeFingerprintParameters("weapon-ability-grant", { frame: "antecedent" }, 9)).toThrow();
      expect(() => normalizeFingerprintParameters("weapon-property-scope", { frame: "antecedent" }, 4)).toThrow();
    });
  });
});

describe("Semantic authoring \"Or:\" options as whole groups", () => {
  const pick: Item = ["Or:", "instead", { choice: true }];
  const stat = (wording: string, characteristics: string[], value: number, weaponType: string): Item =>
    [wording, "characteristic-modifier", { subject: "this-unit", characteristics, operation: "improve", value, weapon_type: weaponType }];
  const give = (wording: string, name: string, weaponType: string): Item => [wording, "weapon-ability-grant", { subject: "this-unit", weapon_type: weaponType, keyword: name }];

  it("keeps an option's rider in that option, not applied beside the choice", () => {
    const text = "The squad's shooting kit receives +2 S. Or: +2 S and AP, together with Hazardous.";
    const effect = compiled(text, placed(text,
      ["The squad's shooting kit receives", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
      stat("+2 S", ["S"], 2, "ranged"),
      pick,
      stat("+2 S and AP", ["S", "AP"], 2, "ranged"),
      give("Hazardous", "Hazardous", "ranged"),
    ));
    expect(effect.type).toBe("choice");
    expect(effect.options).toHaveLength(2);
    expect(effect.options[1].type).toBe("sequence");
    expect(JSON.stringify(effect.options[1])).toContain("hazardous");
    expect(JSON.stringify(effect.options[0])).not.toContain("hazardous");
  });

  it("makes one choice of three options from two markers, the third under its own condition", () => {
    const text = "The squad's kit gains Precision. Or: Lance. Or: If the squad is entrenched, Precision and Lance.";
    const effect = compiled(text, placed(text,
      give("Precision", "Precision", "all"),
      pick,
      give("Lance", "Lance", "all"),
      pick,
      ["If the squad is entrenched", "designated-filter", { subject: "this-unit", tag: "entrenched", negated: false }],
      give("Precision", "Precision", "all"),
      give("Lance", "Lance", "all"),
    ));
    expect(effect.type).toBe("choice");
    expect(effect.options.map((option: Record<string, unknown>) => option.type)).toEqual(["weapon-ability-grant", "weapon-ability-grant", "sequence"]);
    for (const step of effect.options[2].steps) expect(step).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { filter: { designated: "entrenched" } } } });
  });
});

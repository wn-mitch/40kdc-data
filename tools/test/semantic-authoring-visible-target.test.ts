import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { describeAbility } from "../src/translate/index.js";

type Item = [string, string, Record<string, unknown>];

/** Normalized leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

const attack: Item = ["This unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged", target: "following-filter" }];
const grant: Item = ["have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged" }];
const keyword: Item = ["Example Keyword", "weapon-ability-keyword", { keyword: "Ignores Cover" }];

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

describe("an attack's visible target", () => {
  const text = "This unit's ranged attacks that target a visible enemy unit have [Example Keyword].";

  it("keeps visible on the target filter, seen by the attacker", () => {
    const mechanics = mechanicsOf(text, attack, ["visible enemy unit", "unit-filter", { side: "enemy", visible: true }], grant, keyword);
    expect(mechanics.effect.condition).toEqual({ operator: "and", operands: [
      { type: "attack-is", parameters: { attack_type: "ranged" } },
      { type: "matches", parameters: { subject: "defender", filter: { owner: "enemy", visible: { to: "attacker" } } } },
    ] });
    expect(describeAbility({ ability_id: "fabricated-visible-target", ...mechanics } as never)).toContain("the target is an enemy unit that is visible to the attacking unit");
    // An unseen target (an Indirect Fire attack) gets nothing; a seen one gets the keyword.
    const source = { kind: "ability", abilityId: "fabricated-visible-target", abilityKind: "unit" } as const;
    expect(effectToBuffs(mechanics.effect, source, { phase: "shooting", targetVisible: false }).applied).toEqual([]);
    expect(effectToBuffs(mechanics.effect, source, { phase: "shooting", targetVisible: true }).applied.map((buff) => buff.contribution))
      .toEqual([{ type: "extra-keyword", keywordRef: { keyword_id: "ignores-cover" } }]);
  });
});

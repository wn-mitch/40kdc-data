import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-target-exclusions" });

function compiled(text: string, ...items: Item[]): Record<string, unknown> {
  const result = run(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

/** Every node of a type in a compiled tree. */
function nodes(tree: unknown, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ((node as Record<string, unknown>).type === type) found.push(node as Record<string, unknown>);
      Object.values(node).forEach(walk);
    }
  };
  walk(tree);
  return found;
}

const TEXT = "Your Command phase. One ALPHA unit from your army that is Below Half-strength (excluding BETA units). Until the end of the battle round, your unit's ranged weapons other than [ONE SHOT] ones gain [HAZARDOUS].";
const WINDOW: Item = ["Your Command phase", "use-window", { your_phases: ["command"], opponent_phases: [], either_phases: [] }];
const ONE: Item = ["One", "stratagem-target", { count: "one" }];
const ALPHA: Item = ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
const OWNER: Item = ["from your army", "unit-owner", { owner: "friendly" }];
const BELOW: Item = ["that is Below Half-strength", "unit-state", { states: ["below-half-strength"], subject: "antecedent", negated: false }];
const EXCLUDING: Item = ["excluding BETA units", "unit-filter", { side: "friendly", excluded_keywords: ["BETA"] }];
const UNTIL: Item = ["Until the end of the battle round", "duration", { endpoint: "end-of-battle-round" }];
const GRANT: Item = ["your unit's ranged weapons other than [ONE SHOT] ones gain [HAZARDOUS]", "weapon-ability-grant",
  { subject: "this-unit", keyword: "Hazardous", weapon_type: "ranged", exclude_weapon_keyword: "One Shot" }];

describe("Semantic authoring Stratagem target exclusions", () => {
  it("merges an exclusion past the target's owner and state into the target's filter", () => {
    const result = run(TEXT, WINDOW, ONE, ALPHA, OWNER, BELOW, EXCLUDING, UNTIL, GRANT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    // The exclusion narrows the target; it is not left behind as a stray unit-filter.
    expect(result.core?.target_restrictions).toMatchObject({ required_keywords: ["ALPHA"], excluded_keywords: ["BETA"] });
  });

  it("refuses an exclusion naming the other side from the target", () => {
    const enemy: Item = ["excluding BETA units", "unit-filter", { side: "enemy", excluded_keywords: ["BETA"] }];
    const result = run(TEXT, WINDOW, ONE, ALPHA, OWNER, BELOW, enemy, UNTIL, GRANT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toContain("differs from the Stratagem target's side");
  });

  it("merges a filter of alternatives alone past the target's position", () => {
    const text = "Your Command phase. One ALPHA unit within 6\" of an enemy unit. You can only select a VEHICLE unit if it is a CHARACTER unit. Until the end of the battle round, your unit's ranged weapons other than [ONE SHOT] ones gain [HAZARDOUS].";
    const near: Item = ["within 6\" of an enemy unit", "unit-position", { kind: "within", inches: 6, of: "matching-unit", subject: "target", negated: false, of_side: "enemy" }];
    const only: Item = ["You can only select a VEHICLE unit if it is a CHARACTER unit", "unit-filter", { side: "friendly", alternatives: [{ excluded_keywords: ["VEHICLE"] }, { keywords: ["CHARACTER"] }] }];
    const result = run(text, WINDOW, ONE, ALPHA, near, only, UNTIL, GRANT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const eligibility = JSON.stringify(result.core?.target_restrictions);
    expect(eligibility).toContain('"none_of":["VEHICLE"]');
    expect(eligibility).toContain('"all_of":["CHARACTER"]');
    // A filter that also names its own keywords is a unit of its own, not a restriction on the target.
    const named: Item = ["You can only select a VEHICLE unit if it is a CHARACTER unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"], alternatives: [{ excluded_keywords: ["VEHICLE"] }, { keywords: ["CHARACTER"] }] }];
    expect(run(text, WINDOW, ONE, ALPHA, near, named, UNTIL, GRANT).ok).toBe(false);
  });
});

describe("Semantic authoring roll caps", () => {
  const text = "When making the charge roll, if the result is greater than 6 (after modifiers), change it to 6.";
  const moment: Item = ["When making the charge roll", "event", { kind: "before-roll", roll: "charge" }];
  const band = (from: number): Item => ["if the result is greater than 6 (after modifiers)", "roll-result", { from }];
  const fix: Item = ["change it to 6", "roll-auto-result", { roll: "charge", outcome: "counts-as-6" }];

  it("caps the named roll at 6 when a band from 7 precedes a fixed 6", () => {
    expect(nodes(compiled(text, moment, band(7), fix), "roll-result")).toEqual([{ type: "roll-result", target: "this-unit", modifier: { roll: "charge", at_most: 6 } }]);
  });

  it("leaves any other band to the dice that roll it", () => {
    expect(run(text, moment, band(5), fix).ok).toBe(false);
  });
});

describe("Semantic authoring weapon-ability-grant exclusions", () => {
  it("lowers an excluded weapon keyword to the grant's weapon scope", () => {
    const grants = nodes(compiled(TEXT, WINDOW, ONE, ALPHA, OWNER, BELOW, EXCLUDING, UNTIL, GRANT), "weapon-ability-grant");
    expect(grants).toHaveLength(1);
    expect((grants[0]!.modifier as Record<string, unknown>).weapons).toEqual({ type: "ranged", exclude_keyword: { keyword_id: "one-shot" } });
  });

  it("refuses selecting and excluding the same weapon keyword", () => {
    expect(() => normalizeFingerprintParameters("weapon-ability-grant", { subject: "this-unit", keyword: "Hazardous", weapon_type: "ranged", weapon_keyword: "Pistol", exclude_weapon_keyword: "Pistol" }, currentFamilyVersion("weapon-ability-grant")))
      .toThrow(/both select and exclude/u);
  });

  it("refuses an exclusion on a grant to one bound weapon", () => {
    expect(() => normalizeFingerprintParameters("weapon-ability-grant", { subject: "this-model", keyword: "Hazardous", weapon_type: "ranged", weapon: "antecedent", exclude_weapon_keyword: "One Shot" }, currentFamilyVersion("weapon-ability-grant")))
      .toThrow(/exclude_weapon_keyword cannot combine with weapon/u);
  });
});

describe("Semantic authoring charged-against history", () => {
  it("reads \"was charged\" as a charge move made against the unit, not a declared charge", () => {
    const text = "Each time a model in this unit makes a melee attack, if this unit was charged this turn, add 1 to the Wound roll.";
    const mechanics = compiled(text,
      ["Each time a model in this unit makes a melee attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["this unit was charged this turn", "unit-activity", { activities: ["was-charged-this-turn"], subject: "this-unit", negated: false }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]);
    const history = nodes(mechanics, "happened").map((node) => node.parameters);
    expect(history).toEqual([{ event: "move-ended", subject: { owner: "any" }, object: "this-unit", filter: { move_types: ["charge"] }, window: "turn" }]);
  });
});

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const FIGHT_WINDOW = { your_phases: [], opponent_phases: [], either_phases: ["fight"] };
const grant = (wording: string): Array<[string, string, Record<string, unknown>]> => [
  [wording, "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" }],
  ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
];

// Core rule 01.02.02: a rule that says when it triggers and prints no duration lasts for that period.
describe("Round 5C window period as the default duration", () => {
  it("bounds a Stratagem's lasting grant to the phase it is used in", () => {
    const text = "Fight phase. One ALPHA unit. Your unit's melee attacks have [PRECISION].";
    const mechanics = mechanicsOf(placed(text,
      ["Fight phase", "use-window", FIGHT_WINDOW],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ...grant("Your unit's melee attacks have")), text);
    expect(mechanics.scope).toEqual({ duration: "phase" });
  });

  it("keeps a printed duration over the window's period", () => {
    const text = "Fight phase. One ALPHA unit. Until the end of the turn, your unit's melee attacks have [PRECISION].";
    const mechanics = mechanicsOf(placed(text,
      ["Fight phase", "use-window", FIGHT_WINDOW],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ...grant("your unit's melee attacks have")), text);
    expect(mechanics.scope).toEqual({ duration: "turn" });
  });

  it("leaves a passive phase-gated modifier permanent: the gate already holds it to the phase", () => {
    const text = "In your Shooting phase, add 1 to the Hit roll for this unit.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(mechanics.behavior).toBe("passive");
    expect(mechanics.scope).toEqual({ duration: "permanent" });
  });

  it("does not bound a used ability whose effects are all one-off", () => {
    const text = "In your Shooting phase, you can have this unit suffer D3 mortal wounds.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["you can", "optional-use", { who: "you" }],
      ["this unit suffer D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "D3" }]), text);
    expect(mechanics.behavior).toBe("activated");
    expect(mechanics.scope).toEqual({ duration: "permanent" });
  });

  it("bounds a used ability's lasting modifier to its phase", () => {
    const text = "In your Shooting phase, you can add 1 to the Hit roll for this unit.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["you can", "optional-use", { who: "you" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(mechanics.behavior).toBe("activated");
    expect(mechanics.scope).toEqual({ duration: "phase" });
  });

  it("keeps the phase period when the windows fold into one either-phase any-of", () => {
    const text = "In your Shooting phase and the Fight phase, you can add 1 to the Hit roll for this unit.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["the Fight phase", "phase-window", { phase: "fight" }],
      ["you can", "optional-use", { who: "you" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(mechanics.behavior).toBe("activated");
    expect(mechanics.effect.condition.operator).toBe("or");
    expect(mechanics.scope).toEqual({ duration: "phase" });
  });

  it("leaves an any-of that holds a non-window alternative without a window period", () => {
    const text = "In your Shooting phase or while this unit is within 6\" of an enemy unit, you can add 1 to the Hit roll for this unit.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["while this unit is within 6\" of an enemy unit", "unit-position", { subject: "this-unit", relation: "within", distance: 6, of: "enemy-unit" }],
      ["you can", "optional-use", { who: "you" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(mechanics.scope).toEqual({ duration: "permanent" });
  });

  it("bounds a used ability named only by its turn to that turn", () => {
    const text = "In your turn, you can add 1 to the Hit roll for this unit.";
    const mechanics = mechanicsOf(placed(text,
      ["In your turn", "phase-window", { turn: "your" }],
      ["you can", "optional-use", { who: "you" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(mechanics.scope).toEqual({ duration: "turn" });
  });
});

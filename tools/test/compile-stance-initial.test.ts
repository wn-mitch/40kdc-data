import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// A re-selectable protocol the unit starts the battle in. Wording is fabricated.

const text = "At the start of the battle, if this model is leading a **FIXTURE ROBOTS** unit, that unit enters Aegis Protocols (see below). In your Command phase, if this model is leading a **FIXTURE ROBOTS** unit, you can select one protocol from those listed below for that unit to enter. Once a unit enters a protocol, it remains in that protocol until it enters a different one.\n■ **Protector Protocol:** Add 2 to the Attacks characteristic of ranged weapons equipped by **FIXTURE ROBOT** models in that unit.\n■ **Conqueror Protocol:** Add 2 to the Attacks characteristic of melee weapons equipped by **FIXTURE ROBOT** models in that unit.\n■ **Aegis Protocol:** Add 1 to the Toughness characteristic of **FIXTURE ROBOT** models in that unit.";
const items: Array<readonly [string, string, Record<string, unknown>]> = [
  ["At the start of the battle, if this model is leading a **FIXTURE ROBOTS** unit, that unit enters Aegis Protocols", "stance-initial", { option_id: "aegis-protocol" }],
  ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
  ["if this model is leading a **FIXTURE ROBOTS** unit", "leading-unit", { subject: "this-model", attachment: "leading", attached_to_keywords: ["FIXTURE ROBOTS"] }],
  ["you can", "optional-use", { who: "you" }],
  ["select one protocol from those listed below for that unit to enter", "stance-select-open", { scope: "unit", mode: "re-selectable", min_choices: 1, max_choices: 1 }],
  ["Once a unit enters a protocol, it remains in that protocol until it enters a different one", "duration", { endpoint: "end-of-battle" }],
  ["Protector Protocol", "named-option", { label: "Protector Protocol", option_id: "protector-protocol" }],
  ["Add 2 to the Attacks characteristic of ranged weapons equipped by **FIXTURE ROBOT** models in that unit", "characteristic-modifier", { subject: "this-unit", characteristics: ["A"], operation: "add", value: 2, weapon_type: "ranged", model_keywords: ["FIXTURE ROBOTS"] }],
  ["Conqueror Protocol", "named-option", { label: "Conqueror Protocol", option_id: "conqueror-protocol" }],
  ["Add 2 to the Attacks characteristic of melee weapons equipped by **FIXTURE ROBOT** models in that unit", "characteristic-modifier", { subject: "this-unit", characteristics: ["A"], operation: "add", value: 2, weapon_type: "melee", model_keywords: ["FIXTURE ROBOTS"] }],
  ["Aegis Protocol", "named-option", { label: "Aegis Protocol", option_id: "aegis-protocol" }],
  ["Add 1 to the Toughness characteristic of **FIXTURE ROBOT** models in that unit", "characteristic-modifier", { subject: "this-unit", characteristics: ["T"], operation: "add", value: 1, weapon_type: "all", model_keywords: ["FIXTURE ROBOTS"] }],
];

const compiled = (list: typeof items) => compileLeaves(placed(text, ...list), text);

describe("stance-initial", () => {
  it("names the option in force from the start on the stance-select after it", () => {
    const result = compiled(items);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const stance = (result.mechanics.effect as Record<string, any>).effect;
    expect(stance.type).toBe("stance-select");
    expect(stance.initial).toBe("aegis-protocol");
    expect(stance.options.map((option: Record<string, unknown>) => option.id)).toEqual(["protector-protocol", "conqueror-protocol", "aegis-protocol"]);
    expect(result.mechanics.scope).toEqual({ duration: "battle" });
  });

  it("refuses an initial option the stance does not list, and one with no stance after it", () => {
    const unknown = items.map((item) => item[1] === "stance-initial" ? [item[0], item[1], { option_id: "fixture-protocol" }] as const : item);
    const refused = compiled(unknown);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.join(" ")).toMatch(/none of the stance's options/u);
    const alone = compiled(items.filter((item) => item[1] !== "stance-select-open" && item[1] !== "named-option"));
    expect(alone.ok).toBe(false);
  });
});

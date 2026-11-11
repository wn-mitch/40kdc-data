import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

type Item = [string, string, Record<string, unknown>, string];

/** Leaves on their own wording in `text`, in order, each in its own fragment (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment };
  });
}

const TEXT = [
  "Your Shooting phase.",
  "One VESPID unit from your army that has not been selected to shoot this phase. The first time you use this Stratagem, you must also select one objective marker that is not in your opponent's deployment zone; until the end of the battle, this becomes your Trap objective marker.",
  "Until the end of the phase, each time a model in your unit makes a ranged attack that targets an enemy unit within range of your Trap objective marker, add 1 to the Hit roll.",
  "You cannot use this Stratagem during the first battle round.",
].join("\n");

const OUTSIDE: Item = ["that is not in your opponent's deployment zone", "in-region", { region_kind: "territory", territory: "enemy-deployment-zone", negated: true }, "TARGET"];

function leaves(text: string, territory: Item): CompileLeaf[] {
  return placed(text,
    ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["VESPID unit", "unit-filter", { side: "friendly", keywords: ["VESPID"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["that has not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "this-unit", negated: true }, "TARGET"],
    ["The first time you use this Stratagem", "usage-limit", { frequency: "first-this-battle", per: "army" }, "TARGET"],
    ["you must also select one objective marker", "select-objective-open", { bind_as: "trap-objective" }, "TARGET"],
    territory,
    ["until the end of the battle", "duration", { endpoint: "end-of-battle" }, "TARGET"],
    ["this becomes your Trap objective marker", "apply-mark", { subject: "selected-objective", tag: "trap" }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["model in your unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }, "EFFECT"],
    ["enemy unit", "unit-filter", { side: "enemy" }, "EFFECT"],
    ["within range of your Trap objective marker", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "target", negated: false, objective: "designated", objective_tag: "trap" }, "EFFECT"],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }, "EFFECT"],
    ["You cannot use this Stratagem during the first battle round", "battle-round", { min: 2 }, "RESTRICTIONS"],
  );
}

function compiled(text: string, territory: Item = OUTSIDE) {
  const result = compileLeaves(leaves(text, territory), text, { abilityId: "fabricated-lure-stratagem", name: "Lure" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, any>;
}

describe("a Stratagem that also picks an objective the first time it is used", () => {
  it("limits only the objective pick to the first use, and keeps the pick's territory on the selector", () => {
    const mechanics = compiled(TEXT);
    const [pick, buff] = mechanics.effect.steps;
    // The once-per-battle limit gates the pick alone; the Hit buff applies on every use.
    expect(pick).toMatchObject({ type: "ability-part", usage: { frequency: "first-this-battle", per: "army" } });
    expect(pick.effect).toMatchObject({ type: "select-objective", selector: { filter: { outside_territory: "enemy-deployment-zone" } } });
    expect(JSON.stringify(pick.effect)).toContain('"tag":"trap"');
    expect(mechanics.usage).toBeUndefined();
    expect(buff.usage).toBeUndefined();
    expect(JSON.stringify(buff)).toContain('"roll":"hit"');
  });

  it("reads an unnegated territory as the zone the objective must be in", () => {
    const text = TEXT.replace("that is not in your opponent's deployment zone", "that is in your deployment zone");
    const inside: Item = ["that is in your deployment zone", "in-region", { region_kind: "territory", territory: "your-deployment-zone", negated: false }, "TARGET"];
    const [pick] = compiled(text, inside).effect.steps;
    expect(pick.effect.selector.filter).toEqual({ territory: "your-deployment-zone" });
  });
});

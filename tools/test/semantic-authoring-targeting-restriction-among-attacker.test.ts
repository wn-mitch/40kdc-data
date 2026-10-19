import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

// Fabricated wording only: the names and keywords are invented. The sentence structure is what
// the compiler reads: a use window, two named targets, an attacker among-filter, an attack, a
// restriction whose by and target are antecedents, and an enemy among-filter inside the restriction.

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string, mode?: "overlap"];

/** Leaves on their own wording in `text`, in order. An `overlap` item may sit inside the span before it. */
function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  let anchor = 0;
  return items.map(([wording, family, parameters, fragment, mode]) => {
    const overlap = mode === "overlap";
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), overlap ? anchor : from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    if (!overlap) { from = end; anchor = start; }
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment };
  });
}

const TEXT = "Start of your Shooting phase. Two ALPHA units from your army that have not been selected to shoot this phase, and one enemy unit. "
  + "Until the end of the phase, each time a model in either of your units makes an attack, it can only target that enemy unit (and only if it is an eligible target for that attack).";

const WHEN: Item = ["Start of your Shooting phase.", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"];
const TWO: Item = ["Two", "stratagem-target", { count: "exactly", count_exact: 2 }, "TARGET"];
const ALPHA: Item = ["ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"];
const OWNER: Item = ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"];
const NOT_SELECTED: Item = ["that have not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "each-target", negated: true }, "TARGET"];
const ONE: Item = ["one", "stratagem-target", { count: "one" }, "TARGET"];
const ENEMY: Item = ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET"];
const UNTIL: Item = ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"];
const EITHER: Item = ["either of your units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "any" }, "RESTRICTIONS"];
const MAKES: Item = ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }, "RESTRICTIONS"];
const RESTRICTION = (by: string, target: string): Item => ["it can only target that enemy unit (and only if it is an eligible target for that attack)", "targeting-restriction", { by, target, may: "must-target", kind: "attack", weapon_type: "all" }, "RESTRICTIONS"];
const THAT_ENEMY: Item = ["that enemy unit", "unit-filter", { side: "enemy", among: "stratagem-targets", targets: "one" }, "RESTRICTIONS", "overlap"];

const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

function compiled(text: string, items: Item[]): { mechanics: Record<string, any> } {
  const result = compileLeaves(placed(text, items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { mechanics: result.mechanics as unknown as Record<string, any> };
}

function refused(text: string, items: Item[]): string {
  const result = compileLeaves(placed(text, items), text);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

const first = { stratagem_target: "first" };
const second = { stratagem_target: "second" };
const third = { stratagem_target: "third" };

describe("Semantic authoring targeting restriction by an among-attacker and a named enemy target", () => {
  it("binds the restriction's by to each attacker and its target to the enemy (per-attacker sequence)", () => {
    const { mechanics } = compiled(TEXT, [WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY]);
    expect(mechanics.effect.type).toBe("sequence");
    const restrictions = mechanics.effect.steps.filter((step: { type: string }) => step.type === "targeting");
    expect(restrictions).toEqual([
      { type: "targeting", target: first, modifier: { by: first, may: "must-target", kind: "attack", target: third } },
      { type: "targeting", target: second, modifier: { by: second, may: "must-target", kind: "attack", target: third } },
    ]);
    expect(effectOk(mechanics.effect)).toBe(true);
  });

  it("does not take the enemy target as by, even when the enemy filter sits inside the restriction", () => {
    const { mechanics } = compiled(TEXT, [WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY]);
    const json = JSON.stringify(mechanics.effect);
    expect(json).not.toContain('"by":{"stratagem_target":"third"}');
    expect(json).not.toContain("event-subject");
  });

  it("refuses an antecedent by with no among-filter naming the attacker before it", () => {
    const message = refused(TEXT, [WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY]);
    expect(message).toContain("no among-filter names the attacker");
  });

  it("refuses an enemy among-filter in a restriction whose target is not antecedent", () => {
    const message = refused(TEXT, [WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "selected-unit"), THAT_ENEMY]);
    expect(message).toContain("whose target is not antecedent");
  });

});

describe("Semantic authoring each-target conditions count targets, not target groups", () => {
  it("accepts an each-target activity after an exactly-two target group, and applies it to both targets", () => {
    const { mechanics } = compiled(TEXT, [WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY]);
    expect(mechanics.effect.type).toBe("sequence");
  });

  it("still refuses an each-target condition when only one target precedes it", () => {
    const text = "Start of your Shooting phase. One ALPHA unit that has not been selected to shoot this phase, and one enemy unit.";
    const message = refused(text, [
      ["Start of your Shooting phase.", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["that has not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "each-target", negated: true }, "TARGET"],
      ["one enemy unit", "stratagem-target", { count: "one" }, "TARGET"],
      ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET", "overlap"],
    ]);
    expect(message).toContain("each target follows only one target");
  });
});

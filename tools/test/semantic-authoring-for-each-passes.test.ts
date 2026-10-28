import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-glade-claim", name: "Glade Claim" });

const TEXT = "At the end of your Command phase, if a friendly SPRITE unit is controlling an objective, that objective is secured. Until you lose control of that objective, while an enemy unit is within range of that objective, that enemy unit is Spotted.";
const MOMENT: Item = ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }];
const FRIENDLY_PASS: Item = ["a", "for-each-unit-select", { scope: "friendly", distance: "any" }];
const SPRITES: Item = ["friendly SPRITE unit", "unit-filter", { side: "friendly", keywords: ["SPRITE"] }];
const CONTROLS: Item = ["controlling an objective", "controls-objective", { mode: "count", count_min: 1 }];
const SECURED: Item = ["objective is secured", "sticky-objective", { subject: "recipient" }];
const UNTIL: Item = ["Until you lose control of that objective", "duration", { endpoint: "control-lost" }];
const ENEMY_PASS: Item = ["an", "for-each-unit-select", { scope: "enemy", distance: "any" }];
const ENEMY: Item = ["enemy unit", "unit-filter", { side: "enemy" }];
const IN_RANGE: Item = ["within range of that objective", "unit-position", { kind: "objective-range", controlled_by: "you", subject: "recipient", negated: false, objective: "designated", objective_tag: "secured" }];
const SPOTTED: Item = ["that enemy unit is Spotted", "apply-mark", { subject: "antecedent", tag: "spotted" }];

describe("two for-each-unit-select passes in separate sentences", () => {
  it("compile as the record plus a later part, and the secured markers are tagged for the second pass", () => {
    const result = run(TEXT, MOMENT, FRIENDLY_PASS, SPRITES, CONTROLS, SECURED, UNTIL, ENEMY_PASS, ENEMY, IN_RANGE, SPOTTED);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("sequence");
    const [first, part] = effect.steps;
    expect(JSON.stringify(first)).toContain('"type":"designate","target":"recipient","modifier":{"subject":{"objective":{"controlled_by_unit":"recipient"}},"tag":"secured"}');
    expect(part).toMatchObject({ type: "ability-part", duration: "control-lost", effect: { type: "for-each-unit", selector: { filter: { owner: "enemy" } } } });
    expect(JSON.stringify(part.effect)).toContain('"designated":"secured"');
    expect(result.mechanics.trigger).toMatchObject({ event: "phase-ended" });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
    expect(describeAbility(result.mechanics as never)).toContain("Until you no longer control that objective marker");
  });

  it("refuses two passes in one sentence, and a second pass reading secured markers the first never secures", () => {
    const one = "At the end of your Command phase, a friendly SPRITE unit and an enemy unit are Spotted.";
    const same = run(one, MOMENT, FRIENDLY_PASS, SPRITES, ENEMY_PASS, ENEMY, ["are Spotted", "apply-mark", { subject: "antecedent", tag: "spotted" }]);
    expect(same.ok ? "" : same.errors.join(" ")).toContain("two for-each-unit-select passes");
    const unsecured = "At the end of your Command phase, if a friendly SPRITE unit is controlling an objective, that unit is Spotted. Until you lose control of that objective, while an enemy unit is within range of that objective, that enemy unit is Spotted.";
    const none = run(unsecured, MOMENT, FRIENDLY_PASS, SPRITES, CONTROLS, ["that unit is Spotted", "apply-mark", { subject: "antecedent", tag: "spotted" }], UNTIL, ENEMY_PASS, ENEMY, IN_RANGE, SPOTTED);
    expect(none.ok ? "" : none.errors.join(" ")).toContain("the first pass secures none");
  });
});

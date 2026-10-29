import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-tripwires", name: "Tripwires" });

const TEXT = "At the end of your Shooting phase, if this unit is controlling an objective, that objective is snared. While an objective is snared, when an enemy unit ends a move within range of that objective, roll one D6: on a 3+, that enemy unit suffers 1 mortal wound. That objective is no longer snared.";
const PHASE_END: Item = ["At the end of your Shooting phase", "event", { kind: "phase-end", phase: "shooting", turn: "your" }];
const MARK: Item = ["if this unit is controlling an objective, that objective is snared", "mark-objective", { tag: "snared", objective: "controlled-by-unit" }];
const ENEMY: Item = ["enemy unit", "unit-filter", { side: "enemy" }];
const MOVE_ENDED: Item = ["ends a move", "event", { kind: "move-ended", owner: "enemy" }];
const NEAR_SNARED: Item = ["within range of that objective", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "event-subject", negated: false, objective: "designated", objective_tag: "snared" }];
const ROLL: Item = ["roll one D6", "dice-roll", { dice: "D6" }];
const BAND: Item = ["on a 3+", "roll-result", { from: 3 }];
const WOUND: Item = ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "event-subject", count: "1" }];
const CLEAR: Item = ["That objective is no longer snared", "mark-objective", { tag: "snared", objective: "tagged", near: "event-subject", clear: true }];

const NEAR_SNARED_CONDITION = { type: "matches", parameters: { subject: "event-subject", filter: { within: { of: { objective: { designated: "snared" } }, range: "objective-control" } } } };

describe("mark-objective and the reaction while an objective is tagged", () => {
  it("tags the unit's controlled markers, then nests the reaction under the entry moment, gated as a whole and clearing the near marker", () => {
    const result = run(TEXT, PHASE_END, MARK, ENEMY, MOVE_ENDED, NEAR_SNARED, ROLL, BAND, WOUND, CLEAR);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const entry = result.mechanics.effect as Record<string, any>;
    // One part at the entry moment: the reaction exists only once a marker is snared, not for the whole battle.
    expect(entry).toMatchObject({ type: "ability-part", trigger: { event: "phase-ended" } });
    const [mark, reaction] = entry.effect.steps;
    expect(mark).toEqual({ type: "designate", target: "this-unit", modifier: { subject: { objective: { controlled_by_unit: "this-unit" } }, tag: "snared" } });
    expect(reaction.type).toBe("ability-part");
    expect(reaction.duration).toBeUndefined();
    // The condition in the moment's clause decides the moment: the roll and the clear both sit under it.
    expect(reaction.trigger).toEqual({ event: "move-ended", subject: { owner: "enemy" }, condition: NEAR_SNARED_CONDITION });
    expect(reaction.effect.steps[0]).toMatchObject({ type: "dice-gated", threshold: 3, on_success: { type: "mortal-wounds", target: "event-subject" } });
    expect(reaction.effect.steps[1]).toEqual({ type: "designate", target: "this-unit", modifier: { subject: { objective: { designated: "snared", within: { range: "objective-control", of: "event-subject" } } }, tag: "snared", clear: true } });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(entry), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("keeps a later moment a sibling part when no earlier effect applies the tag it reads", () => {
    const other = TEXT.replace("that objective is snared.", "that objective is warded.");
    const result = run(other, PHASE_END, ["if this unit is controlling an objective, that objective is warded", "mark-objective", { tag: "warded", objective: "controlled-by-unit" }], ENEMY, MOVE_ENDED, NEAR_SNARED, ROLL, BAND, WOUND, CLEAR);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step: Record<string, any>) => step.trigger?.event)).toEqual(["phase-ended", "move-ended"]);
  });

  it("refuses a tagged selection that only re-tags, and near without tagged", () => {
    expect(() => normalizeFingerprintParameters("mark-objective", { tag: "snared", objective: "tagged" }, 1)).toThrow(/only clears the tag/);
    expect(() => normalizeFingerprintParameters("mark-objective", { tag: "snared", objective: "controlled-by-unit", near: "event-subject" }, 1)).toThrow(/needs objective tagged/);
    expect(() => normalizeFingerprintParameters("mark-objective", { tag: "not-a-designation", objective: "controlled-by-unit" }, 1)).toThrow(/not a registered designation/);
  });
});

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const DESTROYED = "Each time a model in this unit is destroyed";
const AFTER = "after the attacking unit has finished making its attacks";

function split(between: string, band: string): { text: string; leaves: CompileLeaf[] } {
  const text = `${DESTROYED}${between}${AFTER}, roll one D6. ${band}`;
  const leaves = placed(text,
    [DESTROYED, "event", { kind: "model-destroyed" }],
    [AFTER, "event", { kind: "attacks-resolved", owner: "enemy" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["On a 4+", "roll-result", { from: 4 }],
  );
  return { text, leaves };
}

describe("a destruction resolved after the attacking unit's attacks", () => {
  it("is one destruction trigger timed after the attacks, not two alternative triggers", () => {
    const band = "On a 4+, add one **FABLED SPRITE** model to this unit.";
    const { text, leaves } = split(", ", band);
    const all = [...leaves, ...placed(text, ["add one **FABLED SPRITE** model to this unit", "add-unit", { source: "datasheet", count: "1", datasheet: "fabled-sprites", join: true }])];
    const mechanics = mechanicsOf(all.sort((a, b) => a.start_byte - b.start_byte), text);
    expect(Array.isArray(mechanics.trigger)).toBe(false);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed", filter: { timing: "after-attacks" } });
  });

  it("keeps two moments when a sentence break stands between them", () => {
    const band = "On a 4+, add one **FABLED SPRITE** model to this unit.";
    const text = `${DESTROYED}, roll one D6. ${band} Then, ${AFTER}, add one **FABLED SPRITE** model to this unit.`;
    const leaves = placed(text,
      [DESTROYED, "event", { kind: "model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 4+", "roll-result", { from: 4 }],
      ["add one **FABLED SPRITE** model to this unit", "add-unit", { source: "datasheet", count: "1", datasheet: "fabled-sprites", join: true }],
      [AFTER, "event", { kind: "attacks-resolved", owner: "enemy" }],
      ["add one **FABLED SPRITE** model to this unit", "add-unit", { source: "datasheet", count: "1", datasheet: "fabled-sprites", join: true }],
    );
    const result = compileLeaves(leaves, text);
    const flat = JSON.stringify(result.ok ? result.mechanics : result.errors);
    expect(flat).not.toContain("after-attacks");
  });
});

describe("if X, A, and if Y, B", () => {
  const band = "On a 4+, if it was a **FABLED SPRITE**, add two **DIM SPRITE** models to this unit, and if it was a **DIM SPRITE**, add one **ASH SPRITE** model to this unit.";
  const { text, leaves } = split(", ", band);
  const all = [...leaves, ...placed(text,
    ["if it was a **FABLED SPRITE**", "unit-keyword", { keywords: ["FABLED SPRITE"], subject: "antecedent", negated: false }],
    ["add two **DIM SPRITE** models to this unit", "add-unit", { source: "datasheet", count: "2", datasheet: "dim-sprites", join: true }],
    ["if it was a **DIM SPRITE**", "unit-keyword", { keywords: ["DIM SPRITE"], subject: "antecedent", negated: false }],
    ["add one **ASH SPRITE** model to this unit", "add-unit", { source: "datasheet", count: "1", datasheet: "ash-sprites", join: true }],
  )].sort((a, b) => a.start_byte - b.start_byte);

  it("gates each effect by its own condition, side by side under the band", () => {
    const effect = mechanicsOf(all, text).effect;
    expect(effect.type).toBe("dice-gated");
    const steps = effect.on_success.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: "conditional", condition: { parameters: { filter: { all_of: ["FABLED SPRITE"] } } }, effect: { modifier: { datasheet: "dim-sprites" } } });
    expect(steps[1]).toMatchObject({ type: "conditional", condition: { parameters: { filter: { all_of: ["DIM SPRITE"] } } }, effect: { modifier: { datasheet: "ash-sprites" } } });
  });

  it("still lets a condition of the roll's own sentence gate both", () => {
    const guarded = `${DESTROYED}, ${AFTER}, if this unit is not destroyed, roll one D6. ${band}`;
    const withGuard = placed(guarded,
      [DESTROYED, "event", { kind: "model-destroyed" }],
      [AFTER, "event", { kind: "attacks-resolved", owner: "enemy" }],
      ["if this unit is not destroyed", "unit-state", { states: ["on-battlefield"], subject: "this-unit", negated: false }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 4+", "roll-result", { from: 4 }],
      ["if it was a **FABLED SPRITE**", "unit-keyword", { keywords: ["FABLED SPRITE"], subject: "antecedent", negated: false }],
      ["add two **DIM SPRITE** models to this unit", "add-unit", { source: "datasheet", count: "2", datasheet: "dim-sprites", join: true }],
      ["if it was a **DIM SPRITE**", "unit-keyword", { keywords: ["DIM SPRITE"], subject: "antecedent", negated: false }],
      ["add one **ASH SPRITE** model to this unit", "add-unit", { source: "datasheet", count: "1", datasheet: "ash-sprites", join: true }],
    );
    const mechanics = mechanicsOf(withGuard, guarded);
    const flat = JSON.stringify(mechanics.effect);
    // The on-battlefield guard sits above both branches, not inside the first one only.
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.condition).toMatchObject({ parameters: { filter: { state: "on-battlefield" } } });
    expect(flat.match(/on-battlefield/g)).toHaveLength(1);
    expect(mechanics.effect.effect.on_success.steps).toHaveLength(2);
  });
});

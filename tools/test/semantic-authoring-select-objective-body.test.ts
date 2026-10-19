import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-objective-body" });

const OPEN: Item = ["Select one objective marker", "select-objective-open", { bind_as: "marker" }];
const IN_RANGE: Item = ["While this model is within range of that objective", "unit-position", { kind: "objective-range", objective: "selected", subject: "this-model", negated: false }];
const FIRST: Item = ["this model has Fights First", "fights-first", { subject: "this-model" }];
const PAIN: Item = ["It also has Feel No Pain 5+", "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }];
const TEXT = "Select one objective marker. While this model is within range of that objective, this model has Fights First. It also has Feel No Pain 5+.";

function refusal(text: string, ...items: Item[]): string {
  const result = run(text, ...items);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

describe("Semantic authoring select-objective: every sentence after the opener is its body", () => {
  it("folds a condition and two effect sentences into one conditional over a sequence", () => {
    const result = run(TEXT, OPEN, IN_RANGE, FIRST, PAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("select-objective");
    expect(effect.effect.type).toBe("conditional");
    expect(effect.effect.effect.type).toBe("sequence");
    expect(effect.effect.effect.steps).toHaveLength(2);
  });

  it("still compiles a single sentence after the opener, as before", () => {
    const text = "Select one objective marker. While this model is within range of that objective, this model has Fights First.";
    const result = run(text, OPEN, IN_RANGE, FIRST);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.mechanics.effect as Record<string, any>).effect.type).toBe("conditional");
  });

  it("refuses an opener with no sentence after it", () => {
    expect(refusal("Select one objective marker.", OPEN)).toMatch(/needs exactly one sentence after it/u);
  });

  it("keeps refusing two sentences after a persistent designation", () => {
    const text = "Select one enemy unit to be this model's quarry. This model has Fights First. It also has Feel No Pain 5+.";
    const designation: Item = ["to be this model's quarry", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-model" }];
    expect(refusal(text, designation, ["This model has Fights First", "fights-first", { subject: "this-model" }], PAIN)).toMatch(/needs exactly one sentence after it/u);
  });

  it("does not fold a later sentence that opens a moment, into the conditional body", () => {
    const text = `${TEXT} Each time this model fights, it has Fights First.`;
    const result = run(text, OPEN, IN_RANGE, FIRST, PAIN, ["Each time this model fights", "event", { kind: "attacks-resolved", subject: "this-model" }], ["it has Fights First", "fights-first", { subject: "this-model" }]);
    // The moment's sentence is its own part of the ability (a sibling), never a third step of the objective's body.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = (result.mechanics.effect as Record<string, any>).steps as Array<Record<string, any>>;
    expect(steps[0]!.effect.effect.steps).toHaveLength(2);
    expect(steps[1]!.type).toBe("ability-part");
  });

  it("refuses rather than folds a later sentence with a usage limit, a phase or a duration", () => {
    const withLater = (sentence: string, ...later: Item[]) => refusal(`${TEXT} ${sentence}`, OPEN, IN_RANGE, FIRST, PAIN, ...later);
    expect(withLater("Once per turn, this model has Fights First.", ["Once", "usage-limit", { frequency: "once-per-turn" }], ["per turn", "usage-scope", { per: "model" }], ["this model has Fights First", "fights-first", { subject: "this-model" }]))
      .toMatch(/needs exactly one sentence after it/u);
    expect(withLater("In the Fight phase, this model has Fights First.", ["In the Fight phase", "phase-window", { phase: "fight", turn: "either" }], ["this model has Fights First", "fights-first", { subject: "this-model" }]))
      .toMatch(/needs exactly one sentence after it/u);
    expect(withLater("Until the end of the turn, this model has Fights First.", ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }], ["this model has Fights First", "fights-first", { subject: "this-model" }]))
      .toMatch(/needs exactly one sentence after it/u);
  });
});

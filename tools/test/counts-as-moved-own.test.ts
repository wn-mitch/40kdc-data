import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { foldCountsAsMoved } from "../src/semantic-authoring/compile-counts-as-moved.js";
import { currentFamilyVersion, normalizeFingerprintParameters as normalizeAt } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/effect.js";
import { annotated, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// A unit's own disembark permission ("this unit can disembark … if it does, it counts as having
// made a move that phase, and cannot declare a charge"): the permission's subject is the unit that
// disembarks, so the status and the refusal bind to it. Wording is fabricated.

const TEXT = "Fabricated rule. This squad can leave its ride after it sped. If it does, it counts as having made a Test move that phase, and cannot declare a Test charge in the same turn, but acts freely in the remainder of the turn.";
const PERMISSION = { subject: "this-unit", activity: "disembark", allow: true, despite: ["advanced"] };
const OWN = { move_type: "normal", window: "phase", units: "permission-subject" };
const REFUSAL = { subject: "this-unit", activity: "declare-charge", allow: false };
const END_OF_TURN = { endpoint: "end-of-turn" };

const items = (counts: Record<string, unknown> = OWN, refusal: Record<string, unknown> = REFUSAL): Item[] => [
  ["This squad can leave its ride after it sped", "eligibility-permission", PERMISSION],
  ["it counts as having made a Test move that phase", "counts-as-moved", counts],
  ["cannot declare a Test charge", "eligibility-permission", refusal],
  ["in the remainder of the turn", "duration", END_OF_TURN],
];
const IF_IT_DOES = [{ surface: "If it does" }];
const normalizeFingerprintParameters = (family: string, parameters: Record<string, unknown>) => normalizeAt(family, parameters, currentFamilyVersion(family));
const errorsOf = (leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, TEXT);
  return result.ok ? "" : result.errors.join(" | ");
};

describe("counts-as-moved version 2: units", () => {
  it("accepts units permission-subject and still normalizes every version 1 leaf unchanged", () => {
    expect(normalizeFingerprintParameters("counts-as-moved", OWN)).toEqual(OWN);
    expect(normalizeFingerprintParameters("counts-as-moved", { move_type: "normal" })).toEqual({ move_type: "normal" });
    expect(normalizeFingerprintParameters("counts-as-moved", { move_type: "normal", window: "phase" })).toEqual({ move_type: "normal", window: "phase" });
  });

  it("refuses another units value, and still refuses what version 1 refused", () => {
    expect(() => normalizeFingerprintParameters("counts-as-moved", { move_type: "normal", units: "carried-units" })).toThrow();
    expect(() => normalizeFingerprintParameters("counts-as-moved", { move_type: "advance", units: "permission-subject" })).toThrow();
    expect(() => normalizeFingerprintParameters("counts-as-moved", { units: "permission-subject" })).toThrow();
  });
});

describe("foldCountsAsMoved for the permission's own subject", () => {
  it("folds the status, its phase window and the charge refusal into the permission, and drops the trailing turn duration", () => {
    const folded = foldCountsAsMoved(placed(TEXT, ...items()), TEXT);
    expect(folded.map((leaf) => leaf.family_id)).toEqual(["eligibility-permission"]);
    expect(folded[0]!.parameters).toEqual({ ...PERMISSION, counts_as_move: "normal", counts_as_until: "end-of-phase", then_cannot: ["declare-charge"] });
  });

  it("without units, the same this-unit layout still refuses as the Transport gap", () => {
    expect(() => foldCountsAsMoved(placed(TEXT, ...items({ move_type: "normal", window: "phase" })), TEXT)).toThrow(/DSL_GAP.*cannot name them.*charge refusal/);
  });

  it("refuses a refusal of another unit than the permission's subject", () => {
    expect(() => foldCountsAsMoved(placed(TEXT, ...items(OWN, { ...REFUSAL, subject: "this-model" })), TEXT)).toThrow(/refuses this-model/);
  });

  it("refuses a leaf other than a move-ended event between the permission and the status", () => {
    const text = "This squad can leave its ride. It may also relocate. If it does, it counts as having made a Test move.";
    const leaves = placed(text,
      ["This squad can leave its ride", "eligibility-permission", PERMISSION],
      ["It may also relocate", "make-move", { subject: "this-unit", move_type: "normal" }],
      ["it counts as having made a Test move", "counts-as-moved", { move_type: "normal", units: "permission-subject" }]);
    expect(() => foldCountsAsMoved(leaves, text)).toThrow(/other than at most one move-ended event/);
  });

  it("keeps a turn duration that does not follow a folded refusal", () => {
    const text = "This squad can leave its ride. If it does, it counts as having made a Test move until the turn ends.";
    const folded = foldCountsAsMoved(placed(text,
      ["This squad can leave its ride", "eligibility-permission", PERMISSION],
      ["it counts as having made a Test move", "counts-as-moved", { move_type: "normal", units: "permission-subject" }],
      ["until the turn ends", "duration", END_OF_TURN]), text);
    expect(folded.map((leaf) => leaf.family_id)).toEqual(["eligibility-permission", "duration"]);
    expect(folded[0]!.parameters.then_cannot).toBeUndefined();
  });
});

describe("a folded own-subject permission through compileLeaves", () => {
  it("compiles to one permission with no turn scope, under a reviewed \"If it does\"", () => {
    const leaves = annotated(TEXT, placed(TEXT, ...items()), IF_IT_DOES);
    expect(errorsOf(leaves)).toBe("");
    const result = compileLeaves(leaves, TEXT);
    if (!result.ok) throw new Error("unreachable");
    expect(result.mechanics.effect).toEqual({
      type: "permission", target: "this-unit",
      modifier: { activity: "disembark", allow: true, despite: ["advanced"], counts_as_move: "normal", counts_as_until: "end-of-phase", then_cannot: ["declare-charge"] },
    });
    expect(result.mechanics.scope).toEqual({ duration: "permanent" });
  });

  it("still refuses an \"If it does\" whose consequent another fold consumed", () => {
    // The refusal is a consequent; without units it is not folded into the permission, so the gap stands.
    const leaves = annotated(TEXT, placed(TEXT, ...items({ move_type: "normal", window: "phase" })), IF_IT_DOES);
    expect(errorsOf(leaves)).toMatch(/DSL_GAP/);
  });
});

describe("the permission's counts_as_until and then_cannot", () => {
  const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
  const permission = (modifier: Record<string, unknown>) => ({ type: "permission", target: "this-unit", modifier: { activity: "disembark", allow: true, ...modifier } });

  it("are valid DSL together and apart", () => {
    expect(validate(permission({ counts_as_move: "normal", counts_as_until: "end-of-phase", then_cannot: ["declare-charge"] }))).toBe(true);
    expect(validate(permission({ then_cannot: ["declare-charge", "shoot"] }))).toBe(true);
  });

  it("refuses counts_as_until without counts_as_move, then_cannot on a refusal, and unknown values", () => {
    expect(validate(permission({ counts_as_until: "end-of-phase" }))).toBe(false);
    expect(validate(permission({ allow: false, then_cannot: ["declare-charge"] }))).toBe(false);
    expect(validate(permission({ counts_as_move: "normal", counts_as_until: "end-of-turn" }))).toBe(false);
    expect(validate(permission({ then_cannot: [] }))).toBe(false);
    expect(validate(permission({ then_cannot: ["dance"] }))).toBe(false);
  });

  it("render as what using the permission does to its subject", () => {
    const render = (modifier: Record<string, unknown>, target: unknown = "this-unit") =>
      describeAbility({ ability_id: "x", name: "x", scope: { duration: "permanent" }, effect: { type: "permission", target, modifier: { activity: "disembark", allow: true, ...modifier } } } as never);
    expect(render({ despite: ["advanced"], counts_as_move: "normal", counts_as_until: "end-of-phase", then_cannot: ["declare-charge"] })).toBe(
      "The unit is eligible to disembark even if it Advanced this turn; if it does, it counts as having made a Normal move that phase, and cannot declare a charge this turn.",
    );
    expect(render({ counts_as_move: "normal" })).toBe("The unit is eligible to disembark; if it does, it counts as having made a Normal move this turn.");
    expect(render({ then_cannot: ["declare-charge", "shoot"] }, { owner: "friendly" })).toBe(
      "All friendly units are eligible to disembark; if they do, they cannot declare a charge or shoot this turn.",
    );
  });
});

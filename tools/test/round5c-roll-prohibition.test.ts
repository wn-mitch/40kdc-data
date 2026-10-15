import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { CONFLICTING_DURATIONS } from "../src/round5c/compile-durations.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

// Fabricated wording only. Each shape keeps the sentence structure of a real record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, ...pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

function compile(text: string, ...pieces: Piece[]) {
  return compileLeaves(placed(text, ...pieces), text);
}

function errorsOf(text: string, ...pieces: Piece[]): string[] {
  const result = compile(text, ...pieces);
  return result.ok ? [] : result.errors;
}

const DEADLY_DEMISE = { roll: "deadly-demise" };
const spawnAuto = { roll: "deadly-demise", outcome: "auto-pass" };

// "Do not roll one dice to settle whether widgets are spawned by your Bloom ability. Instead, widgets are automatically spawned."
const SPAWN_TEXT = "Do not roll one dice to settle whether widgets are spawned by your Bloom ability. Instead, widgets are automatically spawned.";
const spawnPieces: Piece[] = [
  ["Do not roll", "roll-prohibition", DEADLY_DEMISE],
  ["Instead", "instead", {}, "EFFECT"],
  ["widgets are automatically spawned", "roll-auto-result", spawnAuto, "EFFECT"],
];

const halvedIf: Record<string, unknown> = { states: ["below-half-strength"], subject: "target", negated: false };

describe("a roll prohibition and its instead (compile-roll-prohibition.ts)", () => {
  it("compiles to the replacement alone, with no dice roll left", () => {
    const result = compile(SPAWN_TEXT, ...spawnPieces);
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain("deadly-demise");
    expect(json).not.toContain("roll-prohibition");
    expect(json).not.toMatch(/"dice"/u);
  });

  it("refuses an instead that replaces a different roll than the one the prohibition names", () => {
    const errors = errorsOf(SPAWN_TEXT, ["Do not roll", "roll-prohibition", { roll: "hit" }], ...spawnPieces.slice(1));
    expect(errors).toContain("\"Instead\" after a roll prohibition replaces only the roll it names (hit).");
  });

  it("refuses an instead that is not an automatic result on the named roll", () => {
    const errors = errorsOf(SPAWN_TEXT, spawnPieces[0]!, spawnPieces[1]!,
      ["widgets are automatically spawned", "roll-auto-result", { roll: "deadly-demise", outcome: "counts-as-6" }, "EFFECT"]);
    expect(errors).toContain("\"Instead\" after a roll prohibition replaces only the roll it names (deadly-demise).");
  });

  it("refuses a prohibition with no instead in its place", () => {
    const text = "Do not roll one dice to settle whether widgets are spawned by your Bloom ability.";
    const errors = errorsOf(text, ["Do not roll", "roll-prohibition", DEADLY_DEMISE]);
    expect(errors).toContain("\"Do not roll deadly-demise\" has no \"instead\" saying what happens in its place.");
  });

  it("refuses a prohibition that shares its sentence with a dice roll", () => {
    const text = "Do not roll one dice to settle whether widgets are spawned on a 4+ by your Bloom ability. Instead, widgets are automatically spawned.";
    // The fragments mark the sentence's leaves alike: a fragment change between leaves starts a new sentence.
    const pieces: Piece[] = [["Do not roll", "roll-prohibition", DEADLY_DEMISE, "EFFECT"], ["one dice", "dice-roll", { dice: "D6" }, "EFFECT"],
      ["on a 4+", "roll-result", { from: 4 }, "EFFECT"], ...spawnPieces.slice(1)];
    expect(errorsOf(text, ...pieces)).toContain("A roll prohibition shares its sentence with a dice roll; retire the dice roll it forbids.");
  });

  it("gives an ungated replacement the prohibition's condition", () => {
    const text = "If the foe is halved, Do not roll one dice to settle whether widgets are spawned. Instead, widgets are automatically spawned.";
    const result = compile(text,
      ["If the foe is halved", "unit-state", halvedIf, "EFFECT"],
      ["Do not roll", "roll-prohibition", DEADLY_DEMISE],
      ["Instead", "instead", {}, "EFFECT"],
      ["widgets are automatically spawned", "roll-auto-result", spawnAuto, "EFFECT"]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("\"below\":\"half\"");
  });

  it("refuses a gated replacement when the prohibition has no condition", () => {
    const text = "Do not roll one dice to settle whether widgets are spawned. Instead, if the foe is halved, widgets are automatically spawned.";
    const errors = errorsOf(text, spawnPieces[0]!, spawnPieces[1]!,
      ["if the foe is halved", "unit-state", halvedIf, "EFFECT"],
      ["widgets are automatically spawned", "roll-auto-result", spawnAuto, "EFFECT"]);
    expect(errors).toContain("\"Instead\" after a roll prohibition needs the same condition as the prohibition.");
  });

  it("refuses when the prohibition and the replacement carry different conditions", () => {
    const text = "If the foe is halved, Do not roll one dice to settle whether widgets are spawned. Instead, if the foe is not halved, widgets are automatically spawned.";
    const errors = errorsOf(text,
      ["If the foe is halved", "unit-state", halvedIf, "EFFECT"],
      ["Do not roll", "roll-prohibition", DEADLY_DEMISE],
      ["Instead", "instead", {}, "EFFECT"],
      ["if the foe is not halved", "unit-state", { ...halvedIf, negated: true }, "EFFECT"],
      ["widgets are automatically spawned", "roll-auto-result", spawnAuto, "EFFECT"]);
    expect(errors).toContain("\"Instead\" after a roll prohibition needs the same condition as the prohibition.");
  });

  it("refuses a prohibition whose durations are bound (the duration cannot be split from the replacement)", () => {
    const text = "Until the end of the phase, Do not roll one dice to settle whether widgets are spawned. Instead, widgets are automatically spawned until the end of the turn.";
    const errors = errorsOf(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["Do not roll", "roll-prohibition", DEADLY_DEMISE],
      ["Instead", "instead", {}, "EFFECT"],
      ["widgets are automatically spawned", "roll-auto-result", spawnAuto, "EFFECT"],
      ["until the end of the turn", "duration", { endpoint: "end-of-turn" }]);
    expect(errors).toContain(CONFLICTING_DURATIONS);
  });

  it("normalises the roll enum and refuses unknown roll names and extra keys", () => {
    const family = "roll-prohibition";
    const version = currentFamilyVersion(family);
    expect(normalizeFingerprintParameters(family, { roll: "deadly-demise" }, version)).toEqual({ roll: "deadly-demise" });
    expect(() => normalizeFingerprintParameters(family, { roll: "not-a-roll" }, version)).toThrow();
    expect(() => normalizeFingerprintParameters(family, { roll: "hit", subject: "this-unit" }, version)).toThrow();
  });
});

// "Each time a foe unit is selected to Fall Back, you can roll one D6: on a 3+, that foe unit must Remain Stationary instead."
const FALL_BACK_TEXT = "Each time a foe unit is selected to Fall Back, you can roll one D6: on a 3+, that foe unit must Remain Stationary instead.";
const fallBackMoment: Record<string, unknown> = { kind: "selected", move_types: ["fall-back"] };
const restriction = (activity: string, subject = "antecedent"): Record<string, unknown> => ({ subject, activity, allow: false });
const fallBackPieces = (permission: Record<string, unknown> = restriction("fall-back")): Piece[] => [
  ["Each time a foe unit is selected to Fall Back", "event", fallBackMoment, "EVENT"],
  ["you can", "optional-use", { who: "you" }],
  ["roll one D6", "dice-roll", { dice: "D6" }, "EVENT"],
  ["on a 3+", "roll-result", { from: 3 }],
  ["that foe unit must Remain Stationary", "eligibility-permission", permission, "EFFECT"],
  ["instead", "instead", {}, "EFFECT"],
];

describe("an instead that restricts the move its event selected (compile.ts, selected-move restriction)", () => {
  it("accepts the restriction on the selected move, keeping its roll band", () => {
    const result = compile(FALL_BACK_TEXT, ...fallBackPieces());
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain("fall-back");
    expect(json).toContain("\"allow\":false");
  });

  it("refuses a restriction on a move other than the one selected", () => {
    const errors = errorsOf(FALL_BACK_TEXT, ...fallBackPieces(restriction("move")));
    expect(errors).toContain("\"Instead\" has no earlier eligibility-permission effect to replace.");
  });

  it("refuses a restriction whose subject is not the event's subject", () => {
    const errors = errorsOf(FALL_BACK_TEXT, ...fallBackPieces(restriction("fall-back", "this-unit")));
    expect(errors).toContain("\"Instead\" has no earlier eligibility-permission effect to replace.");
  });

  it("refuses when the event selects several moves, one of them not the restricted one", () => {
    const pieces = fallBackPieces();
    pieces[0] = ["Each time a foe unit is selected to Fall Back", "event", { kind: "selected", move_types: ["advance", "fall-back"] }, "EVENT"];
    expect(errorsOf(FALL_BACK_TEXT, ...pieces)).toContain("\"Instead\" has no earlier eligibility-permission effect to replace.");
  });

  it("refuses an ungated restriction", () => {
    const text = "Each time a foe unit is selected to Fall Back, that foe unit must Remain Stationary instead.";
    const errors = errorsOf(text,
      ["Each time a foe unit is selected to Fall Back", "event", fallBackMoment, "EVENT"],
      ["that foe unit must Remain Stationary", "eligibility-permission", restriction("fall-back"), "EFFECT"],
      ["instead", "instead", {}, "EFFECT"]);
    expect(errors).toContain("\"Instead\" has no earlier eligibility-permission effect to replace.");
  });

  it("refuses when an earlier permission of the same activity would be ambiguous", () => {
    const text = "Each time a foe unit is selected to Fall Back, that foe unit may Fall Back. You can roll one D6: on a 3+, that foe unit must Remain Stationary instead.";
    const errors = errorsOf(text,
      ["Each time a foe unit is selected to Fall Back", "event", fallBackMoment, "EVENT"],
      ["that foe unit may Fall Back", "eligibility-permission", { subject: "antecedent", activity: "fall-back", allow: true }, "EFFECT"],
      ["You can", "optional-use", { who: "you" }],
      ["roll one D6", "dice-roll", { dice: "D6" }, "EVENT"],
      ["on a 3+", "roll-result", { from: 3 }],
      ["that foe unit must Remain Stationary", "eligibility-permission", restriction("fall-back"), "EFFECT"],
      ["instead", "instead", {}, "EFFECT"]);
    expect(errors).toContain("\"Instead\" would replace an earlier permission of the same activity; name the replaced permission.");
  });

  it("accepts a restriction beside an earlier permission of a different activity, leaving that permission as it was", () => {
    const text = "Each time a foe unit is selected to Fall Back, that foe unit is eligible to Advance. Roll one D6: on a 3+, that foe unit must Remain Stationary instead.";
    const result = compile(text,
      ["Each time a foe unit is selected to Fall Back", "event", fallBackMoment, "EVENT"],
      ["that foe unit is eligible to Advance", "eligibility-permission", { subject: "antecedent", activity: "advance", allow: true }, "EFFECT"],
      ["Roll one D6", "dice-roll", { dice: "D6" }, "EVENT"],
      ["on a 3+", "roll-result", { from: 3 }],
      ["that foe unit must Remain Stationary", "eligibility-permission", restriction("fall-back"), "EFFECT"],
      ["instead", "instead", {}, "EFFECT"]);
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain("\"activity\":\"advance\"");
    expect(json).toContain("\"allow\":false");
  });

  // Fabricated shape of a record that selects a move, then tests a leadership roll before "instead". Its "this
  // phase" duration is not modelled, and the test is not a dice-gated restriction, so it must not restrict the move.
  it("refuses a Leadership-test instead after a selected move, so the record stays unauthored", () => {
    const text = "Each time a foe unit is selected to Fall Back, roll a Leadership test: on a failure, that foe unit must Remain Stationary instead.";
    const errors = errorsOf(text,
      ["Each time a foe unit is selected to Fall Back", "event", fallBackMoment, "EVENT"],
      ["roll a Leadership test", "test", { target: "event-subject", test: "leadership" }, "EFFECT"],
      ["on a failure", "roll-outcome", { roll: "leadership", result: "failure" }, "EFFECT"],
      ["instead", "instead", {}, "EFFECT"]);
    expect(errors).toContain("\"Instead\" has no earlier test effect to replace.");
  });

  // Fabricated shape of a record whose only leaf is the trigger: the trigger authors no effect.
  it("refuses a selected-move trigger with no effect to compile", () => {
    const text = "Each time a foe unit is selected to Fall Back, it is noted.";
    expect(errorsOf(text, ["Each time a foe unit is selected to Fall Back", "event", fallBackMoment, "EVENT"]))
      .toContain("There is no effect leaf to compile.");
  });
});

describe("roll-prohibition leaf preview and prefill", () => {
  const family = REVIEWED_FAMILY_REGISTRY.find((item) => item.id === "roll-prohibition" && item.version === currentFamilyVersion("roll-prohibition")) as unknown as PrefillFamily;

  it("previews as silent text (the instead after it says what happens), so the describer audit does not list it", () => {
    const preview = previewLeaf({ family_id: "roll-prohibition", parameters: { roll: "deadly-demise" } });
    expect(preview.problem).toBeNull();
    expect(preview.text).toMatch(/^No separate text:/u);
  });

  it("prefills the deadly-demise roll from a deadly demise sentence, and leaves other rolls to the drafter", () => {
    expect(prefillFromSource(family, "Do not roll one D6 to determine whether mortal wounds are inflicted by your model's Deadly Demise ability.")).toMatchObject({ roll: "deadly-demise" });
    expect(prefillFromSource(family, "Do not roll one D6 to settle a hit.")).not.toHaveProperty("roll");
  });
});

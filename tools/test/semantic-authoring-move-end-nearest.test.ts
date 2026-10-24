import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/**
 * Move-end nearest (move-end-nearest, move-end-waiver), the waiver's alternative legal end, the
 * bonus move's feasibility proviso (move-must-end on a move-distance), and the permission bound to
 * the unit a move ends nearest. Every leaf is fabricated wording; each case pins one binding or one
 * refusal.
 */

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = currentFamilyVersion(familyId)): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}

const bonus = (moves: string[] = ["pile-in", "consolidation"]) => leaf("EFFECT", "move-distance", { subject: "this-unit", move_types: moves, bonus: 3 }, 1);
const waiver = () => leaf("RESTRICTION", "move-end-waiver", { rule: "closest-enemy-model" });
const nearest = () => leaf("RESTRICTION", "move-end-nearest", { to: "following-filter" });
const enemyFilter = (extra: Record<string, unknown> = {}) => leaf("CONDITION", "unit-filter", { side: "enemy", ...extra });
const makeMove = () => leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" });
const permitEngaged = () => leaf("EFFECT", "eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["engaged"], engaged_with_move_end: true });
const mustEnd = (match = "any", polarity = "must") => leaf("RESTRICTION", "move-must-end", { match, polarity });
const engaged = () => leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false });

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
}
function refused(leaves: CompileLeaf[]): string {
  const result = compileLeaves(leaves);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

describe("move-end-nearest and move-end-waiver families", () => {
  it("are version 1 and refuse any parameter they do not name", () => {
    expect(currentFamilyVersion("move-end-nearest")).toBe(3);
    expect(currentFamilyVersion("move-end-waiver")).toBe(1);
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "closest-objective" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "following-filter", per: "unit" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("move-end-waiver", { rule: "closest-enemy-unit" }, 1)).toThrow();
  });

  it("makes engaged_with_move_end a version 3 permission that needs despite engaged", () => {
    const current = currentFamilyVersion("eligibility-permission");
    const ok = normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["engaged"], engaged_with_move_end: true }, current);
    expect(ok.engaged_with_move_end).toBe(true);
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["battle-shocked"], engaged_with_move_end: true }, current)).toThrow(/despite to include engaged/u);
  });
});

describe("move-end nearest on a make-move (3670 shape)", () => {
  it("folds the following enemy filter into the nearest end and binds the engaged permission to it", () => {
    const text = compiled([makeMove(), nearest(), enemyFilter({ excluded_keywords: ["AIRCRAFT"] }), permitEngaged()]);
    expect(text).toContain('"ends_nearest":{"of":{"owner":"enemy","none_of":["AIRCRAFT"]}}');
    expect(text).toContain('"engaged_with":"nearest-move-end"');
    expect(text).not.toContain('"waives"');
  });

  it("refuses a nearest end with no unit-filter right after it", () => {
    expect(refused([makeMove(), nearest(), permitEngaged()])).toMatch(/needs a unit-filter right after it/u);
  });

  it("refuses a nearest end with no move before it", () => {
    expect(refused([nearest(), enemyFilter()])).toMatch(/no move to attach to/u);
  });

  it("refuses an engaged permission bound to a nearest end when the ability has none", () => {
    expect(refused([makeMove(), permitEngaged()])).toMatch(/no move-end nearest/u);
  });

  it("refuses a second nearest end on the same move", () => {
    expect(refused([makeMove(), nearest(), enemyFilter(), nearest(), enemyFilter({ side: "friendly" })])).toMatch(/second one has no DSL form/u);
  });
});

describe("waiver with the nearest end on a bonus move (978 shape)", () => {
  it("attaches the nearest end, with the waiver, as its own move-modifier on the bonus's moves", () => {
    const text = compiled([bonus(), waiver(), nearest(), enemyFilter()]);
    // The bonus stays ungated: a move-modifier with the distance and no end rule.
    expect(text).toContain('{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["pile-in","consolidation"],"distance_bonus":3}}');
    // The waiver is its own move-modifier on the same moves, legal either way.
    expect(text).toContain('{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["pile-in","consolidation"],"ends_nearest":{"of":{"owner":"enemy"},"waives":"closest-enemy-model"}}}');
  });

  it("without a waiver, the nearest end is a plain requirement with no waives field", () => {
    const text = compiled([bonus(["consolidation"]), nearest(), enemyFilter()]);
    expect(text).toContain('"ends_nearest":{"of":{"owner":"enemy"}}');
    expect(text).not.toContain("waives");
  });

  it("refuses a waiver with no nearest end in its sentence", () => {
    expect(refused([bonus(), waiver()])).toMatch(/needs a move-end nearest/u);
  });

  it("refuses a waiver whose sentence has a nearest end but no move", () => {
    expect(refused([waiver(), nearest(), enemyFilter()])).toMatch(/no move to attach to/u);
  });
});

describe("move-must-end on a bonus move (feasibility proviso, 5746 shape)", () => {
  it("puts the end condition on the bonus node, which the bonus is available only with", () => {
    const text = compiled([bonus(["consolidation"]), mustEnd(), engaged()]);
    expect(text).toContain('{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["consolidation"],"distance_bonus":3,"ends_when":');
    expect(text).toContain('"ends_when":{"type":"matches","parameters":{"filter":{"state":"engaged"}}}');
    expect(text).not.toContain('"type":"move"');
  });

  it("refuses a cannot restriction after a bonus move, which has no DSL form", () => {
    expect(refused([bonus(["consolidation"]), mustEnd("all", "cannot"), engaged()])).toMatch(/after a move bonus has no DSL form/u);
  });

  it("keeps the no-move refusal when there is neither a make-move nor a bonus in the sentence", () => {
    expect(refused([mustEnd(), engaged()])).toMatch(/has no move before it/u);
  });
});

describe("a move-end's clause gate (6294 shape)", () => {
  const righteous = () => leaf("CONDITION", "rule-active", { rule: "righteous" });

  it("gates the end rule with the clause's condition and leaves the bonus ungated", () => {
    const text = compiled([bonus(), righteous(), waiver(), nearest(), enemyFilter()]);
    // The bonus is not inside the condition: it is a plain move-modifier at the top level.
    expect(text).toMatch(/^\{"effect":\{"type":"sequence","steps":\[\{"type":"move-modifier","target":"this-unit","modifier":\{"applies_to_moves":\["pile-in","consolidation"\],"distance_bonus":3\}\},/u);
    // The waiver's node is the one the condition wraps.
    expect(text).toMatch(/\{"type":"conditional","condition":\{"type":"rule-active","parameters":\{"rule":"righteous"\}\},"effect":\{"type":"move-modifier","target":"this-unit","modifier":\{"applies_to_moves":\["pile-in","consolidation"\],"ends_nearest"/u);
  });
});

describe("the 978 leaf sequence: a move-ended trigger on the bonus's moves", () => {
  const trigger = () => leaf("EVENT", "event", { kind: "move-ended", move_types: ["pile-in", "consolidation"], subject: "antecedent" }, 18);
  const leading = () => leaf("CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" }, 6);

  it("compiles the bonus with its trigger, and the waiver's end rule as a second effect of that trigger", () => {
    const result = compileLeaves([leading(), trigger(), bonus(["pile-in", "consolidation"]), waiver(), nearest(), enemyFilter()]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const text = JSON.stringify(result.mechanics);
    expect(text).toContain('"event":"move-ended"');
    expect(text).toContain('"distance_bonus":3');
    expect(text).toContain('"waives":"closest-enemy-model"');
  });
});

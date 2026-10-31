import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

/** [wording, family, parameters, fragment, inside]: `inside` places the wording within the previous leaf's span. */
type Piece = [string, string, Record<string, unknown>, string, boolean?];

function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  let previousStart = 0;
  return pieces.map(([wording, family, parameters, fragment, inside]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), inside ? previousStart : from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    if (!inside) from = end;
    previousStart = start;
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: end, fragment };
  });
}

const TEXT = "Your opponent's Shooting phase, just after an enemy unit has selected its targets.\nOne friendly KEYA unit.\nUntil the end of the phase, when a **hit roll** for that enemy unit's ranged attacks that target your unit results in a hit, your unit suffers 1 mortal wound.";

const HEADER: Piece[] = [
  ["Your opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
  ["enemy unit", "unit-filter", { side: "enemy" }, "WHEN"],
  ["has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["friendly KEYA unit", "unit-filter", { side: "friendly", keywords: ["KEYA"] }, "TARGET"],
];
const ROLL: Piece = ["when a **hit roll** for that enemy unit's ranged attacks that target your unit results in a hit", "event", { kind: "after-roll", roll: "hit", subject: "event-subject", result: "success" }, "EFFECT"];
const AIMED: Piece = ["ranged attacks that target your unit", "attack-filter", { attack_type: "ranged", target: "that-unit" }, "EFFECT", true];
const WOUND: Piece = ["your unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }, "EFFECT"];

function compiled(pieces: Piece[], text = TEXT) {
  return compileLeaves(placed(text, pieces), text, {});
}

describe("a Stratagem's nested roll moment names the WHEN moment's units (compile-when-subject.ts)", () => {
  it("binds the roll to the enemy unit and the attacks to the unit that enemy unit targeted", () => {
    const result = compiled([...HEADER, ROLL, AIMED, WOUND]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as any;
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected", binds_event_variable: "when-subject" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "after-roll", filter: { roll: "hit", result: "success" }, subject: { event_var: "when-subject" } } });
    expect(mechanics.effect.effect.condition).toEqual({ operator: "and", operands: [
      { type: "attack-is", parameters: { attack_type: "ranged" } },
      { type: "same-unit", parameters: { subject: "defender", as: { event_var: "when-subject", role: "object" } } },
    ] });
    const render = describeAbility({ id: "sample", name: "Sample", ...mechanics });
    expect(render).toContain("Each time an attack made by that unit scores a hit");
    expect(render).toContain("if the attack targets the unit that unit targeted");
  });

  it("keeps the roll's own subject outside a Stratagem", () => {
    const text = "When a **hit roll** for that enemy unit's ranged attacks that target your unit results in a hit, your unit suffers 1 mortal wound.";
    const result = compiled([ROLL, WOUND].map((piece): Piece => [piece[0].replace(/^when/u, "When"), piece[1], piece[2], "RAW_TEXT"]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics as any).trigger.subject).toBe("event-subject");
  });

  it("refuses attacks that target that unit with no WHEN moment to name it", () => {
    const text = "When a **hit roll** for that enemy unit's ranged attacks that target your unit results in a hit, your unit suffers 1 mortal wound.";
    const pieces = [ROLL, AIMED, WOUND].map((piece): Piece => [piece[0].replace(/^when/u, "When"), piece[1], piece[2], "RAW_TEXT", piece[4]]);
    const result = compiled(pieces, text);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/name the unit a Stratagem's WHEN moment targeted/u);
  });

  it("refuses attacks that target that unit in a Stratagem with no moment nested under its WHEN moment", () => {
    const text = TEXT.replace("when a **hit roll** for that enemy unit's ranged attacks that target your unit results in a hit", "while that enemy unit makes ranged attacks that target your unit");
    const result = compiled([...HEADER, [AIMED[0], AIMED[1], AIMED[2], "EFFECT"], WOUND], text);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/name the unit a Stratagem's WHEN moment targeted/u);
  });

  it("takes target that-unit only beside attack_type and negated", () => {
    const version = currentFamilyVersion("attack-filter");
    expect(normalizeFingerprintParameters("attack-filter", { target: "that-unit" }, version)).toEqual({ target: "that-unit" });
    expect(() => normalizeFingerprintParameters("attack-filter", { target: "this-unit" }, version)).toThrow(/must be one of that-unit/u);
    expect(() => normalizeFingerprintParameters("attack-filter", { target: "that-unit", weapon_keyword: "Sample" }, version)).toThrow(/attack_type and negated only/u);
  });
});

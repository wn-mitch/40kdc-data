import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

/**
 * NAME fragment: a span over the record's name column, not source_text. Fabricated wording only.
 */

const NAME_TEXT = "Fabricated Captain (psyker level 3)";
const BODY = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";

function leaf(family: string, parameters: Record<string, unknown>, start: number, end: number, fragment: string): CompileLeaf {
  const version = currentFamilyVersion(family);
  return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment };
}

/** The name leaf: "psyker level 3" inside the name's parentheses. */
function nameLeaf(name = NAME_TEXT): CompileLeaf {
  const start = Buffer.byteLength(name.slice(0, name.indexOf("psyker level 3")), "utf8");
  return leaf("characteristic-set", { subject: "this-model", characteristic: "psyker-level", value: 3 }, start, start + Buffer.byteLength("psyker level 3", "utf8"), "NAME");
}

/** The body: a psychic heading (cost 2 over "psychic level 2"), its roll and its effect. */
function bodyLeaves(text = BODY): CompileLeaf[] {
  const at = (wording: string) => Buffer.byteLength(text.slice(0, text.indexOf(wording)), "utf8");
  const span = (wording: string) => [at(wording), at(wording) + Buffer.byteLength(wording, "utf8")] as const;
  const [cs, ce] = span("psychic level 2");
  const [ps, pe] = span("In your Shooting phase");
  const [ds, de] = span("roll one D6 (psychic)");
  const [rs, re] = span("On a 4+");
  const [ss, se] = span("this unit has +1 Sv");
  return [
    leaf("psychic-level-cost", { level: 2 }, cs, ce, "RAW_TEXT"),
    leaf("phase-window", { phase: "shooting", turn: "your" }, ps, pe, "RAW_TEXT"),
    leaf("dice-roll", { dice: "D6", roll_var: "psychic" }, ds, de, "RAW_TEXT"),
    leaf("roll-result", { from: 4, to: 6 }, rs, re, "RAW_TEXT"),
    leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }, ss, se, "RAW_TEXT"),
  ];
}

describe("Semantic authoring NAME fragment (span over the record's name)", () => {
  it("compiles a name's psyker level beside the body's psychic ability", () => {
    const result = compileLeaves([nameLeaf(), ...bodyLeaves()], BODY, { name: NAME_TEXT });
    expect(result.ok).toBe(true);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"psyker-level"');
    expect(json).toContain('"operation":"set"');
    expect(json).toContain('"value":3');
    // The psychic ability keeps its own cost of 2, and the name's setter is not a psychic segment.
    expect(json).toContain('"amount":2');
  });

  it("refuses a name span when the record has no name", () => {
    const result = compileLeaves([nameLeaf(), ...bodyLeaves()], BODY);
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/record's name/);
  });

  it("refuses a name span that runs past the end of the name", () => {
    const short = "Captain";
    const result = compileLeaves([{ ...nameLeaf(), start_byte: 0, end_byte: 40 }], BODY, { name: short });
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/outside the record's name/);
  });

  it("compiles a name-only span with no source text at all", () => {
    // The span indexes the name; nothing is read from source_text, so an absent source text is no refusal.
    const result = compileLeaves([nameLeaf()], undefined, { name: NAME_TEXT });
    expect(result.ok).toBe(true);
    expect(JSON.stringify((result as { mechanics: unknown }).mechanics)).toContain('"value":3');
  });

  it("keeps body-only records unchanged when no leaf is over the name", () => {
    const body = bodyLeaves();
    expect(compileLeaves(body, BODY, { name: NAME_TEXT })).toEqual(compileLeaves(body, BODY));
  });
});

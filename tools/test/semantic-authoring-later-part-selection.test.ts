import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { nestInSelection } from "../src/semantic-authoring/compile-later-part.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording and identities; no rules text.

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanics(text: string, leaves: CompileLeaf[]): Record<string, any> {
  const result = compileLeaves(leaves, text, {});
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** Every node of `type` in an effect tree, depth-first. */
function nodes(node: unknown, type: string): Record<string, any>[] {
  if (Array.isArray(node)) return node.flatMap((inner) => nodes(inner, type));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((inner) => nodes(inner, type))];
}

describe("a halved roll", () => {
  it("compiles without a value, and a value is refused by the schema's shape", () => {
    const text = "Until the end of the turn, halve Sprint and Dash rolls made for this unit.";
    const result = mechanics(text, placed(text,
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["halve Sprint and Dash rolls made for this unit", "roll-modifier", { operation: "halve", rolls: ["advance", "charge"], subject: "this-unit" }],
    ));
    const [modifier] = nodes(result.effect, "roll-modifier");
    expect(modifier!.modifier.operation).toBe("halve");
    expect(modifier!.modifier).not.toHaveProperty("value");
  });

  it("still requires a value for every other operation", () => {
    const text = "Add to Sprint and Dash rolls made for this unit.";
    expect(() => placed(text,
      ["Add to Sprint and Dash rolls made for this unit", "roll-modifier", { operation: "add", rolls: ["advance", "charge"], subject: "this-unit" }],
    )).toThrow();
  });
});

describe("a later part whose moment names the selected unit", () => {
  const SELECT: Array<[string, string, Record<string, unknown>]> = [
    ["At the start of your opponent’s Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "opponent" }],
    ["you can", "optional-use", { who: "you" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["within 12\" of", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent", negated: false }],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["halve Sprint and Dash rolls made for that unit", "roll-modifier", { operation: "halve", rolls: ["advance", "charge"], subject: "antecedent" }],
  ];
  const LATER = "In addition, if that unit can **FLY**, until the start of your next Movement phase, roll one D6 each time that unit ends a move: on a 4+, that unit suffers 1 mortal wound.";
  const laterLeaves: Array<[string, string, Record<string, unknown>]> = [
    ["that unit can **FLY", "unit-keyword", { keywords: ["FLY"], subject: "antecedent", negated: false }],
    ["until the start of your next Movement phase", "duration", { endpoint: "start-of-next-movement-phase" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["each time that unit ends a move", "event", { kind: "move-ended", subject: "antecedent" }],
    ["on a 4+", "roll-result", { from: 4 }],
    ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
  ];

  it("nests in the selection, under its own window, gated by its own lead-in condition", () => {
    const text = `At the start of your opponent’s Movement phase, you can select one enemy unit within 12" of this model. Until the end of the turn, halve Sprint and Dash rolls made for that unit. ${LATER}`;
    const result = mechanics(text, placed(text, ...SELECT, ...laterLeaves));
    const [selection] = nodes(result.effect, "select-units");
    // The later part sits inside the selection, after the halving, so "that unit" stays the selected unit.
    const steps = selection!.effect.steps as Record<string, any>[];
    expect(steps).toHaveLength(2);
    const later = steps[1]!;
    expect(later).toMatchObject({ type: "ability-part", trigger: { event: "move-ended", subject: "selected-unit" }, duration: "until-next-movement-phase" });
    // The FLY condition printed before the window belongs to the later part, not to the halving.
    expect(JSON.stringify(steps[0])).not.toContain("FLY");
    expect(JSON.stringify(later)).toContain("FLY");
    // The window is the part's own lifetime, not a second wrapper around its effect.
    expect(nodes(later.effect, "ability-part").filter((part) => part.duration !== undefined)).toEqual([]);
  });

  it("nests only into an entry with exactly one selection", () => {
    const part = { type: "ability-part", trigger: { event: "move-ended", subject: "selected-unit" }, effect: { type: "mortal-wounds" } };
    const select = (effect: unknown) => ({ type: "select-units", effect });
    // One selection: the part follows the selection's own step.
    expect(nestInSelection(select({ type: "keyword-grant" }), part)).toEqual(
      select({ type: "sequence", steps: [{ type: "keyword-grant" }, part] }));
    // Two selections, or none: the moment cannot name which, so nothing nests.
    expect(nestInSelection({ type: "sequence", steps: [select({ type: "a" }), select({ type: "b" })] }, part)).toBeNull();
    expect(nestInSelection({ type: "keyword-grant" }, part)).toBeNull();
  });
});

describe("a later part whose lead-in prints the record's window again", () => {
  it("takes that window as its own duration", () => {
    const text = "Until the end of the phase, enemy units ignore this unit when picking ranged targets. Until the end of the phase, each time an enemy model loses a wound, roll one D6: on a 5+, this unit suffers 1 mortal wound.";
    const result = mechanics(text, placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["enemy units ignore this unit when picking ranged targets", "targeting-restriction", { subject: "enemy-units", may: "target", kind: "shoot", weapon_type: "ranged", not_engaged_with: "this-unit" }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["enemy model", "unit-filter", { side: "enemy", level: "model" }],
      ["loses a wound", "event", { kind: "damage-allocated" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 5+", "roll-result", { from: 5 }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
    ));
    const later = nodes(result.effect, "ability-part").find((part) => part.trigger !== undefined);
    expect(later).toMatchObject({ duration: "phase" });
  });
});

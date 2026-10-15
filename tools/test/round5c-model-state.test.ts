import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

/**
 * wounds-remaining, starting-strength and leaves-attached-unit: qualifiers that fold into the
 * set-up, return-models or split-unit before them (compile-model-state.ts). Wording is fabricated.
 */

type Piece = [wording: string, family: string, parameters: Record<string, unknown>];

function placed(text: string, ...items: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    const normalized = normalizeFingerprintParameters(family, parameters, version);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalized, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, ...items: Piece[]) {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function refused(text: string, ...items: Piece[]): string[] {
  const result = compileLeaves(placed(text, ...items), text);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

const setUp = (wording: string, extra: Record<string, unknown> = {}): Piece => [wording, "set-up", { subject: "this-model", to: "battlefield", placement: "closest-to-destruction", ...extra }];
const wounds = (wording: string, value: unknown): Piece => [wording, "wounds-remaining", { value }];
const strength = (wording: string, value = 1): Piece => [wording, "starting-strength", { value }];
const detached = (wording: string): Piece => [wording, "leaves-attached-unit", {}];

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
function authoredBase(): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  return entries.find((item) => item.ability_id === "control-edict-adeptus-mechanicus")!;
}

describe("wounds-remaining, starting-strength and leaves-attached-unit leaves", () => {
  it("normalize to one canonical value and refuse what the families do not name", () => {
    const norm = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
    for (const value of ["full", "half-starting", "D3", "D6", 3, 8]) expect(norm("wounds-remaining", { value })).toEqual({ value });
    // A digit string is the same leaf as the number, so both fingerprint identically.
    expect(norm("wounds-remaining", { value: "3" })).toEqual({ value: 3 });
    for (const value of ["half", "2D6", 0, 1.5, "source"]) expect(() => norm("wounds-remaining", { value })).toThrow();
    expect(norm("starting-strength", { value: 1 })).toEqual({ value: 1 });
    expect(() => norm("starting-strength", { value: 0 })).toThrow();
    expect(norm("leaves-attached-unit", {})).toEqual({});
    expect(() => norm("leaves-attached-unit", { detach: true })).toThrow();
    // return-models widens its wounds to 3 and half of the starting wounds, and nothing else.
    const restore = (wounds_remaining: string) => norm("return-models", { subject: "this-model", count: "1", wounds_remaining });
    expect(restore("3")).toEqual({ subject: "this-model", count: "1", wounds_remaining: "3" });
    expect(restore("half-starting")).toEqual({ subject: "this-model", count: "1", wounds_remaining: "half-starting" });
    expect(() => restore("2")).toThrow();
  });

  it("previews each value in its own words", () => {
    const text = (family: string, parameters: Record<string, unknown>) => previewLeaf({ family_id: family, parameters }).text;
    const notes = ["full", "half-starting", "D3", 3].map((value) => text("wounds-remaining", { value }));
    expect(new Set(notes).size).toBe(4);
    expect(text("wounds-remaining", { value: "half-starting" })).toContain("half of its starting number of wounds");
    expect(text("starting-strength", { value: 2 })).toContain("Starting Strength of 2");
  });

  it("folds wounds into the set-up before it, keeping full as an explicit value", () => {
    const text = "Roll one D6: on a 2+, set this model back up near its grave, with its full wounds remaining.";
    const mechanics = compiled(text, ["Roll one D6", "dice-roll", { dice: "D6" }], ["on a 2+", "roll-result", { from: 2 }],
      setUp("set this model back up near its grave"), wounds("with its full wounds remaining", "full"));
    expect(mechanics.effect.on_success).toEqual({ type: "set-up", target: "this-model", modifier: { to: "battlefield", placement: "closest-to-destruction", wounds_remaining: "full" } });
    expect(JSON.stringify(mechanics)).not.toContain("conditional");
  });

  it("folds a number, a roll or half the starting wounds as the DSL writes them", () => {
    const one = (value: unknown) => compiled("Set this model back up near its grave with some wounds remaining.",
      setUp("Set this model back up near its grave"), wounds("with some wounds remaining", value)).effect.modifier.wounds_remaining;
    expect(one(3)).toBe(3);
    expect(one("D3")).toBe("D3");
    expect(one("half-starting")).toBe("half-starting");
  });

  it("reaches across sentences to the set-up: a separate unit, its Starting Strength and its wounds", () => {
    const text = "Set up the fallen model near its grave. It is not part of a joined unit and its unit has a strength of 1. It has half of its first wounds remaining.";
    const mechanics = compiled(text, setUp("Set up the fallen model near its grave"), detached("It is not part of a joined unit"),
      strength("its unit has a strength of 1"), wounds("It has half of its first wounds remaining", "half-starting"));
    expect(mechanics.effect).toEqual({ type: "set-up", target: "this-model", modifier: {
      to: "battlefield", placement: "closest-to-destruction", wounds_remaining: "half-starting", detach: true, starting_strength: 1,
    } });
    const check = checkEntry(entryWithMechanics(authoredBase(), mechanics as never));
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toContain("with half of its starting number of wounds remaining, as a separate unit with a Starting Strength of 1 (it is no longer part of its attached unit)");
  });

  it("gives each unit a split produces its Starting Strength", () => {
    const text = "Split this unit into one-model units. Each new unit has a strength of 1.";
    const mechanics = compiled(text, ["Split this unit into one-model units", "split-unit", { mode: "model" }], strength("Each new unit has a strength of 1"));
    expect(mechanics.effect).toEqual({ type: "split-unit", target: "this-unit", modifier: { by: "model", starting_strength: 1 } });
    expect(checkEntry(entryWithMechanics(authoredBase(), mechanics as never)).rendered_text).toContain("into units of one model each, each with a Starting Strength of 1");
  });

  it("folds into return-models with the restoration's own wounds semantics", () => {
    const restore: Piece = ["Return one model to this unit", "return-models", { subject: "this-unit", count: "1" }];
    const text = "Return one model to this unit with some wounds remaining.";
    expect(compiled(text, restore, wounds("with some wounds remaining", 3)).effect.modifier).toEqual({ count: 1, wounds_remaining: 3 });
    expect(compiled(text, restore, wounds("with some wounds remaining", "half-starting")).effect.modifier).toEqual({ count: 1, wounds_remaining: "half-starting" });
    // A returned model already comes back with full wounds unless told otherwise.
    expect(compiled(text, restore, wounds("with some wounds remaining", "full")).effect.modifier).toEqual({ count: 1 });
    // The same wounds on the leaf and the qualifier agree; different wounds refuse.
    expect(compiled(text, ["Return one model to this unit", "return-models", { subject: "this-unit", count: "1", wounds_remaining: "3" }], wounds("with some wounds remaining", 3)).effect.modifier)
      .toEqual({ count: 1, wounds_remaining: 3 });
    expect(refused(text, ["Return one model to this unit", "return-models", { subject: "this-unit", count: "1", wounds_remaining: "D3" }], wounds("with some wounds remaining", 3))[0])
      .toMatch(/already has wounds_remaining/u);
  });

  it("refuses a qualifier with no effect it can qualify before it", () => {
    expect(refused("With some wounds remaining, set this model up near its grave.", wounds("With some wounds remaining", 3), setUp("set this model up near its grave"))[0])
      .toMatch(/needs a set-up or return-models effect before it/u);
    // Wounds on a split, or a separate unit for a returned model, are not what those effects take.
    expect(refused("Split this unit into one-model units with some wounds remaining.", ["Split this unit into one-model units", "split-unit", { mode: "model" }], wounds("with some wounds remaining", 3))[0])
      .toMatch(/qualifies only set-up or return-models; the effect before it is split-unit/u);
    expect(refused("Return one model to this unit. It is not part of a joined unit.", ["Return one model to this unit", "return-models", { subject: "this-unit", count: "1" }], detached("It is not part of a joined unit"))[0])
      .toMatch(/qualifies only set-up/u);
    // The nearest effect owns the qualifier: an unrelated effect in between blocks an earlier set-up.
    expect(refused("Set this model up near its grave, then it suffers 1 mortal wound with some wounds remaining.", setUp("Set this model up near its grave"),
      ["it suffers 1 mortal wound", "mortal-wounds", { recipient: "this-model", count: "1" }], wounds("with some wounds remaining", 3))[0])
      .toMatch(/the effect before it is mortal-wounds/u);
  });

  it("does not reach back past a new moment", () => {
    const text = "Set this model up near its grave. At the end of the phase, it has some wounds remaining.";
    const errors = refused(text, setUp("Set this model up near its grave"), ["At the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
      wounds("it has some wounds remaining", 3));
    expect(errors.join(" ")).toMatch(/wounds-remaining qualifier needs a set-up or return-models effect before it/u);
  });
});

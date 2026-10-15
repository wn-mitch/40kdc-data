import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each case keeps the structure of a real ability with invented words.

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

type Piece = [phrase: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their phrases in the text, as the workbench stores them. */
function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters, fragment = "RAW_TEXT"]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const family_version = currentFamilyVersion(family_id);
    return {
      role: familyRole(family_id, family_version),
      family_id,
      family_version,
      parameters: normalizeFingerprintParameters(family_id, parameters, family_version),
      start_byte,
      end_byte: start_byte + Buffer.byteLength(phrase),
      fragment,
    };
  });
}

function compiled(text: string, pieces: Piece[]) {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return result;
}

function refused(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(leavesIn(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const VERB_FIRST = "Redeploy up to three friendly Adeptus Astartes Infantry units. When doing so, you can set those units up in Strategic Reserves instead.";
const SELECT_FIRST = "Select up to three friendly Adeptus Astartes Infantry units. Redeploy them. When doing so, you can set those units up in Strategic Reserves instead.";

const verbFirstPieces: Piece[] = [
  ["Redeploy", "set-up", { subject: "antecedent", to: "battlefield" }],
  ["up to three", "select-unit", { distance: "any", visible: false, count: 3, up_to: true }],
  ["friendly Adeptus Astartes Infantry units", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES", "INFANTRY"] }],
  ["When doing so, you can", "instead", { choice: true }],
  ["set those units up in Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", ignore_limits: true }],
];

const selectFirstPieces: Piece[] = [
  ["Select up to three", "select-unit", { distance: "any", visible: false, count: 3, up_to: true }],
  ["friendly Adeptus Astartes Infantry units", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES", "INFANTRY"] }],
  ["Redeploy them", "set-up", { subject: "antecedent", to: "battlefield" }],
  ["When doing so, you can", "instead", { choice: true }],
  ["set those units up in Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", ignore_limits: true }],
];

/** The effect the record compiles to, as the DSL's own tree. */
const effectOf = (text: string, pieces: Piece[]) => compiled(text, pieces).mechanics.effect;

describe("Round 5C verb-first selections", () => {
  it("binds a set-up that precedes its selection to the selected unit, not this unit", () => {
    const effect = effectOf(VERB_FIRST, verbFirstPieces) as { effect: { options: Array<{ target: string }> } };
    expect(effect.effect.options.map((option) => option.target)).toEqual(["selected-unit", "selected-unit"]);
  });

  it("compiles verb-first to the same select-units choice as the select-first wording", () => {
    const verbFirst = effectOf(VERB_FIRST, verbFirstPieces);
    expect(verbFirst).toEqual({
      type: "select-units",
      selector: expect.objectContaining({ owner: "friendly", max_count: 3 }),
      effect: {
        type: "choice",
        options: [
          expect.objectContaining({ type: "set-up", target: "selected-unit" }),
          expect.objectContaining({ type: "set-up", target: "selected-unit" }),
        ],
      },
    });
    expect(effectOf(SELECT_FIRST, selectFirstPieces)).toEqual(verbFirst);
  });

  it("refuses a verb-first set-up when the record holds a second selection", () => {
    const errors = refused(`${VERB_FIRST} Select one other unit.`, [
      ...verbFirstPieces,
      ["Select one other unit", "select-unit", { distance: "any", visible: false }],
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("set-up at byte 0:");
    expect(errors[0]).toMatch(/second selection makes selected-unit ambiguous/u);
  });

  it("refuses a verb-first set-up when an earlier set-up of this unit shares its part", () => {
    const text = `Move this unit. ${VERB_FIRST}`;
    const errors = refused(text, [
      ["Move this unit", "set-up", { subject: "this-unit", to: "battlefield" }],
      ...verbFirstPieces,
    ]);
    expect(errors.join(" ")).toMatch(/earlier set-up of this unit in the same part makes selected-unit ambiguous/u);
  });

  it("keeps binding a set-up with no following selection to this unit", () => {
    const text = "Redeploy this unit.";
    const antecedent = compiled(text, [["Redeploy", "set-up", { subject: "antecedent", to: "battlefield" }]]).mechanics.effect;
    const literal = compiled(text, [["Redeploy", "set-up", { subject: "this-unit", to: "battlefield" }]]).mechanics.effect;
    expect(antecedent).toEqual(literal);
    expect(JSON.stringify(antecedent)).toContain("this-unit");
  });

  it("refuses an instead choice when no earlier set-up precedes it", () => {
    const text = "Select up to three friendly units. When doing so, you can set them up in Strategic Reserves instead.";
    const errors = refused(text, [
      ["Select up to three", "select-unit", { distance: "any", visible: false, count: 3, up_to: true }],
      ["friendly units", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }],
      ["When doing so, you can", "instead", { choice: true }],
      ["set them up in Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", ignore_limits: true }],
    ]);
    expect(errors).toEqual(['"Or:" needs an effect on each side to choose between.']);
  });

  it("compiles a count of up to three to max_count on the selection", () => {
    const text = "Select up to three friendly units. Move them.";
    const effect = effectOf(text, [
      ["Select up to three", "select-unit", { distance: "any", visible: false, count: 3, up_to: true }],
      ["friendly units", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }],
      ["Move them", "set-up", { subject: "antecedent", to: "battlefield" }],
    ]) as { selector: Record<string, unknown> };
    expect(effect.selector).toMatchObject({ max_count: 3 });
    expect(effect.selector).not.toHaveProperty("count");
  });

  it("compiles the select-first record with a battlefield-or-Strategic-Reserves choice", () => {
    const text = "Select up to three friendly units. Redeploy all of those units. When doing so, you can set them up in Strategic Reserves instead.";
    const effect = effectOf(text, [
      ["Select up to three", "select-unit", { distance: "any", visible: false, count: 3, up_to: true }],
      ["friendly units", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }],
      ["Redeploy all of those units", "set-up", { subject: "antecedent", to: "battlefield" }],
      ["When doing so, you can", "instead", { choice: true }],
      ["set them up in Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", ignore_limits: true }],
    ]) as { type: string; selector: Record<string, unknown>; effect: { type: string } };
    expect(effect.type).toBe("select-units");
    expect(effect.selector).toMatchObject({ max_count: 3 });
    expect(effect.effect.type).toBe("choice");
  });
});

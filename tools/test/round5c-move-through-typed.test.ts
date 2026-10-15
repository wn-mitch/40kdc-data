import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/**
 * move-through version 2: the passthrough can be a typed models item. Each case pins one way the
 * item must compile (owner, keyword lists, canonical order) or one way it must still be refused.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
/** The version that adds the typed item: version 2 is the antecedent subject, so this is the one after it. */
const TYPED = currentFamilyVersion("move-through");

function leaf(familyVersion: number, parameters: Record<string, unknown>): CompileLeaf {
  offset += 10;
  return { role: "EFFECT", family_id: "move-through", family_version: familyVersion, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

describe("move-through typed passthrough (version 2)", () => {
  it("is the current move-through version, with the string tokens still accepted", () => {
    expect(TYPED).toBeGreaterThanOrEqual(3);
    expect(compiled([leaf(TYPED, { subject: "this-unit", passthrough: "models" })]).mechanics.effect)
      .toEqual({ type: "move-modifier", target: "this-unit", modifier: { passthrough: ["models"] } });
  });

  it("compiles enemy models with no exclusion, as the typed item the DSL carries", () => {
    expect(compiled([leaf(TYPED, { subject: "this-model", passthrough: { kind: "models", owner: "enemy" } })]).mechanics.effect)
      .toEqual({ type: "move-modifier", target: "this-model", modifier: { passthrough: [{ kind: "models", owner: "enemy" }] } });
  });

  it("canonicalizes the keyword lists when the leaf is normalized, and compiles the canonical form", () => {
    const canonical = normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "models", owner: "enemy", excluding: ["vehicle", "MONSTER"] },
    }, TYPED);
    expect(canonical.passthrough).toEqual({ kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] });
    expect(compiled([leaf(TYPED, canonical)]).mechanics.effect).toEqual({
      type: "move-modifier", target: "this-unit",
      modifier: { passthrough: [{ kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] }] },
    });
  });

  it("keeps the move types and the all_of keywords alongside the typed item", () => {
    const canonical = normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "models", all_of: ["walker"] }, applies_to_moves: ["normal", "charge"],
    }, TYPED);
    expect(compiled([leaf(TYPED, canonical)]).mechanics.effect).toEqual({
      type: "move-modifier", target: "this-unit",
      modifier: { passthrough: [{ kind: "models", all_of: ["WALKER"] }], applies_to_moves: ["normal", "charge"] },
    });
  });

  it("carries the excluded keywords in the typed item, and refuses them as a separate unit-filter after it", () => {
    expect(compiled([leaf(TYPED, { subject: "this-unit", passthrough: { kind: "models", excluding: ["MONSTER", "VEHICLE"] } })]).mechanics.effect)
      .toEqual({
        type: "move-modifier", target: "this-unit",
        modifier: { passthrough: [{ kind: "models", excluding: ["MONSTER", "VEHICLE"] }] },
      });
    const separate = compileLeaves([
      leaf(TYPED, { subject: "this-unit", passthrough: "models" }),
      { role: "EFFECT", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"), parameters: { side: "any", excluded_keywords: ["MONSTER", "VEHICLE"] }, start_byte: (offset += 10) },
    ]);
    expect(separate.ok).toBe(false);
  });

  // The typed item came with version 3 of move-through; the version before that is two below the current one.
  it("refuses the typed item on the version before it, which only takes string tokens", () => {
    expect(() => normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "models", owner: "enemy" },
    }, TYPED - 2)).toThrow();
  });

  it("refuses a typed item of kind terrain, which this version does not widen", () => {
    expect(() => normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "terrain", height: "up-to-4" },
    }, TYPED)).toThrow(/kind models/u);
  });

  it("refuses an unknown key, an unknown owner, and an empty or malformed keyword list", () => {
    const base = { subject: "this-unit" };
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", height: "over-4" } }, TYPED))
      .toThrow(/unknown key: height/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", owner: "mine" } }, TYPED))
      .toThrow(/owner must be one of/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", excluding: [] } }, TYPED))
      .toThrow(/at least 1 keyword/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", excluding: ["MONSTER", "monster"] } }, TYPED))
      .toThrow(/lists a keyword twice/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", excluding: ["not a keyword!"] } }, TYPED))
      .toThrow(/is not a unit keyword/u);
  });

  it("refuses a quoted source passthrough at compile, since it has no listed value yet", () => {
    expect(() => compiled([leaf(TYPED, { subject: "this-unit", passthrough: { source: "enemy models" } })])).toThrow(/quoted source text/u);
  });

  it("renders the typed item in the describer, so the compiled entry lints and reads back", () => {
    const base = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");
    const entry = entryWithMechanics(base, compiled([leaf(TYPED, {
      subject: "this-unit", passthrough: { kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] },
    })]).mechanics);
    const check = checkEntry(entry);
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toContain("enemy models (excluding MONSTER and VEHICLE models)");
  });
});

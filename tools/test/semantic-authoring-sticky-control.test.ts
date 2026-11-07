import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

/**
 * "If <unit> is controlling an objective, that objective is secured": a sticky objective with a
 * unit subject already means the objectives that unit controls, so the control test folds into it
 * (compile-sticky-control.ts) instead of gating on the army controlling any objective. Fabricated
 * wording throughout.
 */

const EVENT = { family_id: "event", parameters: { kind: "phase-end", phase: "command", turn: "your" } };

function at(text: string, span: string, familyId: string, parameters: Record<string, unknown>, from = 0): CompileLeaf {
  const start = Buffer.from(text).indexOf(Buffer.from(span), from);
  if (start < 0) throw new Error(`No "${span}" in the text.`);
  const version = currentFamilyVersion(familyId);
  return { role: familyRole(familyId, version), family_id: familyId, family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(span), fragment: "RAW_TEXT" };
}

function effectOf(text: string, leaves: CompileLeaf[]): unknown {
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect;
}

/** The sticky leaf opens at the objective after "that", not the one the control test names. */
const afterThat = (text: string) => Buffer.from(text).indexOf("that **");

const PLAIN = { mode: "count", count_min: 1 };

describe("secured objective controlled by a unit", () => {
  it("secures the objectives this unit controls, with no army-wide control gate", () => {
    const text = "At the end of your Command phase, if this unit is holding an **objective**, that **objective** is **secured**.";
    const effect = effectOf(text, [
      at(text, "At the end of your Command phase", EVENT.family_id, EVENT.parameters),
      at(text, "this unit is holding an **objective**", "controls-objective", PLAIN),
      at(text, "objective** is **secured", "sticky-objective", { subject: "this-unit" }, afterThat(text)),
    ]);
    expect(effect).toEqual({ type: "objective-sticky", target: "this-unit" });
  });

  it("secures the objectives each filtered unit controls inside its loop", () => {
    const text = "At the end of your Movement phase, if a friendly **WARDEN** unit is holding an **objective**, that **objective** is **secured**.";
    const effect = effectOf(text, [
      at(text, "At the end of your Movement phase", EVENT.family_id, { kind: "phase-end", phase: "movement", turn: "your" }),
      at(text, "a", "for-each-unit-select", { scope: "friendly", distance: "any" }, 38),
      at(text, "friendly **WARDEN** unit", "unit-filter", { side: "friendly", keywords: ["WARDEN"] }),
      at(text, "holding an **objective**", "controls-objective", PLAIN),
      at(text, "objective** is **secured", "sticky-objective", { subject: "recipient" }, afterThat(text)),
    ]);
    expect(effect).toEqual({
      type: "for-each-unit",
      selector: { filter: { owner: "friendly", all_of: ["WARDEN"] } },
      effect: { type: "objective-sticky", target: "recipient" },
    });
  });

  it("keeps a control test that names a player, a count or a kind of objective as its own gate", () => {
    const text = "At the end of your Command phase, if you are holding an **objective**, that **objective** is **secured**.";
    const sticky = at(text, "objective** is **secured", "sticky-objective", { subject: "this-unit" }, afterThat(text));
    const gated = (parameters: Record<string, unknown>) => effectOf(text, [
      at(text, "At the end of your Command phase", EVENT.family_id, EVENT.parameters),
      at(text, "you are holding an **objective**", "controls-objective", parameters),
      sticky,
    ]) as Record<string, unknown>;
    expect(gated({ ...PLAIN, by: "friendly" })).toMatchObject({ type: "conditional", condition: { type: "controls", parameters: { by: "friendly" } } });
    expect(gated({ mode: "count", count_min: 2 })).toMatchObject({ type: "conditional", condition: { type: "controls" } });
    expect(gated({ ...PLAIN, objective_role: "central" })).toMatchObject({ type: "conditional", condition: { type: "controls" } });
  });

  it("keeps the gate when other words stand between the control test and the secured objective", () => {
    const text = "At the end of your Command phase, if this unit is holding an **objective**, then at once that **objective** is **secured**.";
    const effect = effectOf(text, [
      at(text, "At the end of your Command phase", EVENT.family_id, EVENT.parameters),
      at(text, "this unit is holding an **objective**", "controls-objective", PLAIN),
      at(text, "objective** is **secured", "sticky-objective", { subject: "this-unit" }, afterThat(text)),
    ]) as Record<string, unknown>;
    expect(effect).toMatchObject({ type: "conditional", condition: { type: "controls" } });
  });
});

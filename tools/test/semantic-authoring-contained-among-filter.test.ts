import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

/**
 * An among-filter inside an effect span: the effect's subject is the filter's targets ("Remove
 * those units from the battlefield"). Wording is fabricated. Each item is located at its first
 * occurrence in the text, so an item may sit inside another item's span.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"));
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(wording, "utf8"), fragment };
  });
}

function compiled(text: string, ...items: Item[]): { mechanics: Record<string, any>; target: any } {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { mechanics: result.mechanics as unknown as Record<string, any>, target: result.core?.target_restrictions };
}

function refused(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

const WINDOW: Item = ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"];
const ALPHA: Item = ["Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"];
const ALPHA_UNITS: Item = ["ALPHA units from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"];
const ONE_BETA: Item = ["one", "stratagem-target", { count: "one" }, "TARGET"];
const BETA_UNIT: Item = ["BETA unit from your army", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"];
/** Two target groups (no mode): the first names up to two ALPHA units, the second one BETA unit. */
const GROUPS = "Movement phase. Up to two ALPHA units from your army, and one BETA unit from your army.";
const TARGETS: Item[] = [WINDOW, ALPHA, ALPHA_UNITS, ONE_BETA, BETA_UNIT];
const SEND = "Remove those units from the battlefield and place them into Strategic Reserves";
const THOSE: Item = ["those units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"];
const SET_UP_RESERVES = ["Remove those units from the battlefield and place them into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", from: "battlefield" }, "EFFECT"] as const;
const first = { stratagem_target: "first" };
const second = { stratagem_target: "second" };

describe("Semantic authoring Stratagems: an among-filter inside an effect names the effect's subject", () => {
  const text = `${GROUPS} ${SEND}.`;

  it("binds a set-up's subject to the targets the among-filter names, one set-up per target", () => {
    const { mechanics } = compiled(text, ...TARGETS, [...SET_UP_RESERVES], THOSE);
    expect(mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "set-up", target: first, modifier: { to: "strategic-reserves", from: "battlefield" } },
      { type: "set-up", target: second, modifier: { to: "strategic-reserves", from: "battlefield" } },
    ] });
  });

  it("fans a return-models effect out per target, each target with its own roll", () => {
    const returnText = `${GROUPS} Return up to D3+3 destroyed models to each of those selected units.`;
    const { mechanics } = compiled(returnText, ...TARGETS,
      ["Return up to D3+3 destroyed models to each of those selected units", "return-models", { subject: "antecedent", count: "D3+3" }, "EFFECT"],
      ["those selected units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"]);
    expect(mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "return-models", target: first, modifier: { count: "D3+3" } },
      { type: "return-models", target: second, modifier: { count: "D3+3" } },
    ] });
  });

  it("binds a melee weapon-ability grant's subject to the targets the among-filter names", () => {
    const grantText = `${GROUPS} Until the end of the phase, melee weapons equipped by models in each of those units have the [LETHAL HITS] ability.`;
    const { mechanics } = compiled(grantText, ...TARGETS,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["melee weapons equipped by models in each of those units have the", "weapon-ability-grant", { subject: "antecedent", weapon_type: "melee" }, "EFFECT"],
      ["each of those units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"],
      ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }, "EFFECT"]);
    expect(mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "weapon-ability-grant", target: first, modifier: { keywords: [{ keyword_id: "lethal-hits" }], weapons: { type: "melee" } } },
      { type: "weapon-ability-grant", target: second, modifier: { keywords: [{ keyword_id: "lethal-hits" }], weapons: { type: "melee" } } },
    ] });
  });

  it("refuses a container whose subject is not antecedent", () => {
    expect(refused(text, ...TARGETS,
      [SEND, "set-up", { subject: "this-unit", to: "strategic-reserves", from: "battlefield" }, "EFFECT"], THOSE)).toMatch(/subject is not antecedent/u);
  });

  it("refuses an among-filter inside two effects, which of them it means is unstated", () => {
    const wide = `${GROUPS} Until the end of the phase, remove those units from the battlefield and place them into Strategic Reserves.`;
    expect(refused(wide, ...TARGETS,
      ["Until the end of the phase, remove those units from the battlefield and place them into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", from: "battlefield" }, "EFFECT"],
      ["remove those units from the battlefield and place them into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves", from: "battlefield" }, "EFFECT"],
      THOSE)).toMatch(/inside several effects/u);
  });

  it("refuses an among-filter with no containing effect and no following leaf", () => {
    const loose = `${GROUPS} Those units are ready.`;
    expect(refused(loose, ...TARGETS, ["Those units are ready", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"])).toMatch(/names no leaf in its clause/u);
  });

  it("compiles a two-mode record whose set-up names every target, one step per mode target", () => {
    const moded = "Movement phase. One ALPHA unit, or up to two BETA units. Remove those units from the battlefield and place them into Strategic Reserves.";
    const { mechanics } = compiled(moded, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      [", or up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"],
      ["BETA units", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      [...SET_UP_RESERVES], THOSE);
    expect(mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "set-up", target: first, modifier: { to: "strategic-reserves", from: "battlefield" } },
      { type: "set-up", target: second, modifier: { to: "strategic-reserves", from: "battlefield" } },
    ] });
  });
});

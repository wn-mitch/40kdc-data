import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/**
 * Which trigger moments an optional-use makes optional. The moments of the sentence that offers the
 * use (and the WHEN clauses before it) are the player's choice; a moment opened in a later sentence
 * ("If you do, …, when this unit …") is mandatory once the ability was used. Wording is fabricated.
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

function triggerOf(text: string, ...items: Piece[]): Array<Record<string, unknown>> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const trigger = (result.mechanics as unknown as { trigger: unknown }).trigger;
  return Array.isArray(trigger) ? trigger as Array<Record<string, unknown>> : [trigger as Record<string, unknown>];
}

const selected = (wording: string, to: string): Piece => [wording, "event", { kind: "selected", to }];
const useIt = (wording: string): Piece => [wording, "optional-use", { who: "this-model" }];
const reroll = (wording: string): Piece => [wording, "reroll", { roll: "charge", subset: "all", weapon_type: "all" }];
const declares = (wording: string): Piece => [wording, "event", { kind: "targets-selected", action_kind: "charge" }];

describe("optional-use and the moments it governs", () => {
  it("keeps alternative moments of the sentence that offers the use optional", () => {
    const text = "When this unit is selected to shoot or when it is selected to fight, you can use this ability. This unit can re-roll a charge roll.";
    const moments = triggerOf(text,
      selected("is selected to shoot", "shoot"), selected("is selected to fight", "fight"), useIt("you can use this ability"), reroll("re-roll a charge roll"));
    expect(moments).toHaveLength(2);
    expect(moments.every((moment) => moment.optional === true)).toBe(true);
  });

  it("makes a moment opened after \"if you do\" mandatory while the offering moment stays optional", () => {
    const text = "When this unit is selected to shoot, you can use this ability. If you do, until the end of the turn, when this unit declares a charge, this unit can re-roll that charge roll.";
    const moments = triggerOf(text,
      selected("is selected to shoot", "shoot"), useIt("you can use this ability"), declares("declares a charge"), reroll("re-roll that charge roll"));
    expect(moments).toHaveLength(2);
    expect(moments[0]!.optional).toBe(true);
    expect(moments[1]!.optional).toBeUndefined();
  });

  it("keeps a lone dependent moment optional when no moment offers the use", () => {
    const text = "In the Fight phase, you can use this ability. If you do, when this unit declares a charge, this unit can re-roll that charge roll.";
    const moments = triggerOf(text, useIt("you can use this ability"), declares("declares a charge"), reroll("re-roll that charge roll"));
    expect(moments).toHaveLength(1);
    expect(moments[0]!.optional).toBe(true);
  });
});

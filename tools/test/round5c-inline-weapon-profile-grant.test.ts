import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { weaponLabel } from "../src/translate/effect-words.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function compiled(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

// Inline weapon profiles: the owner prints the weapon's name, and its stats come from the dump
// entity the id names. The leaf therefore carries only the grant and the id.
describe("inline weapon profile grant shapes", () => {
  it("compiles an enhancement's bearer clause and granted weapon (S1 shape)", () => {
    const text = "Alpha model only. This model has the following weapon:";
    const mechanics = compiled(placed(text,
      ["Alpha model only", "bearer-eligibility", { keywords: ["ALPHA"], match: "all", excluded_keywords: [] }],
      ["This model has the following weapon", "weapon-grant", { subject: "this-model", weapon_id: "fab-blade-wurrband" }]), text);
    expect(mechanics.effect).toEqual({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: "fab-blade-wurrband" } });
    expect(mechanics.scope).toEqual({ duration: "permanent" });
  });

  it("compiles a unit's drone wargear grant with no count (S2 shape)", () => {
    const text = "The bearer is equipped with the following ranged weapon:";
    const mechanics = compiled(placed(text,
      ["The bearer is equipped with the following ranged weapon", "weapon-grant", { subject: "this-model", weapon_id: "fab-gun-drone-drone" }]), text);
    expect(mechanics.effect).toEqual({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: "fab-gun-drone-drone" } });
  });

  it("keeps the printed count of a single granted copy (S2 correction shape)", () => {
    const text = "The bearer is equipped with 1 fab cannon.";
    const mechanics = compiled(placed(text,
      ["The bearer is equipped with 1 fab cannon", "weapon-grant", { subject: "this-model", weapon_id: "fab-cannon-drone", count: 1 }]), text);
    expect(mechanics.effect.modifier).toEqual({ weapon_id: "fab-cannon-drone", count: 1 });
  });
});

// Exported wording for a granted weapon: the printed profile name, never the "-drone" disambiguator.
describe("granted weapon label", () => {
  it("drops the drone disambiguator from a drone weapon id", () => {
    expect(weaponLabel("twin-pulse-carbine-drone")).toBe("Twin Pulse Carbine");
    expect(weaponLabel("drone-burst-cannon-drone")).toBe("Drone Burst Cannon");
  });

  it("title-cases an id without the suffix and keeps a curated printed name", () => {
    expect(weaponLabel("missile-pod")).toBe("Missile Pod");
    expect(weaponLabel("tl-4-9-lords-of-the-forge")).toBe("TL-4ø9");
  });
});

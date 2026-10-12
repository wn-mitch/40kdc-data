import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";

/**
 * "If such a weapon already has that ability": the condition after a keyword grant, folded into the
 * critical-hit threshold after it. Every sentence below is fabricated.
 */

type Piece = [wording: string, family: string, parameters: Record<string, unknown>];

function placed(text: string, ...pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "Your unit's weapons have the [SUSTAINED HITS 1] ability. If such a weapon already has that ability, an unmodified Hit roll of 5+ scores a Critical Hit.";
const GRANT = "Your unit's weapons have the [SUSTAINED HITS 1] ability";
const CONDITION = "If such a weapon already has that ability";
const THRESHOLD = "an unmodified Hit roll of 5+ scores a Critical Hit";
const condition = (granted_rating: unknown = "keep"): Piece => [CONDITION, "weapon-has-ability", { weapon: "earlier-grant", ability: "earlier-grant", granted_rating }];
const grant = (parameters: Record<string, unknown> = {}): Piece => [GRANT, "weapon-ability-grant", { subject: "this-unit", keyword: "Sustained Hits 1", weapon_type: "all", ...parameters }];
const threshold = (parameters: Record<string, unknown> = {}): Piece => [THRESHOLD, "critical-hit-threshold", { roll: "hit", value: 5, ...parameters }];

function compiled(text: string, ...pieces: Piece[]) {
  return compileLeaves(placed(text, ...pieces), text);
}
function mechanicsOf(text: string, ...pieces: Piece[]): Record<string, any> {
  const result = compiled(text, ...pieces);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}
function refusalOf(text: string, ...pieces: Piece[]): string {
  const result = compiled(text, ...pieces);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

describe("weapon-has-ability: the family", () => {
  const norm = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("weapon-has-ability", parameters, currentFamilyVersion("weapon-has-ability"));

  it("is a registered condition family at version 1", () => {
    expect(currentFamilyVersion("weapon-has-ability")).toBe(1);
    expect(REVIEWED_FAMILY_REGISTRY.find((family) => family.id === "weapon-has-ability")?.role).toBe("CONDITION");
  });

  it("accepts both stated readings and refuses a leaf that states none, an unknown reading or an extra key", () => {
    expect(norm({ weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "keep" }).granted_rating).toBe("keep");
    expect(norm({ weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "add" }).granted_rating).toBe("add");
    expect(() => norm({ weapon: "earlier-grant", ability: "earlier-grant" })).toThrow(/must be exactly/u);
    expect(() => norm({ weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "both" })).toThrow(/granted_rating/u);
    expect(() => norm({ weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "keep", extra: 1 })).toThrow(/must be exactly/u);
    expect(() => norm({ weapon: "named", ability: "antecedent", granted_rating: "keep" })).toThrow(/weapon/u);
  });
});

describe("weapon-has-ability: compilation", () => {
  it("keep: the grant is unchanged and the threshold selects weapons that print the keyword, rating dropped", () => {
    const mechanics = mechanicsOf(TEXT, grant(), condition("keep"), threshold());
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: "weapon-ability-grant", modifier: { abilities: ["Sustained Hits 1"] } });
    expect(steps[0]!.modifier.if_present).toBeUndefined();
    expect(steps[1]).toMatchObject({ type: "roll-result", modifier: { roll: "hit", critical_on: 5, weapon_keyword: "Sustained Hits" } });
    expect(steps[1]!.modifier.weapon_type).toBeUndefined();
  });

  it("add: the grant raises a rating the weapon already has", () => {
    const steps = mechanicsOf(TEXT, grant(), condition("add"), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[0]!.modifier.if_present).toBe("increment");
    expect(steps[1]!.modifier.weapon_keyword).toBe("Sustained Hits");
  });

  it("a ranged grant puts the weapon type on the roll result", () => {
    const steps = mechanicsOf(TEXT, grant({ weapon_type: "ranged" }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[1]!.modifier).toMatchObject({ weapon_type: "ranged", weapon_keyword: "Sustained Hits" });
  });

  it("strips a numeric threshold rating and a dice rating from the keyword", () => {
    const anti = mechanicsOf(TEXT, grant({ keyword: "Anti-Infantry 5+" }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(anti[1]!.modifier.weapon_keyword).toBe("Anti-Infantry");
    const melta = mechanicsOf(TEXT, grant({ keyword: "Melta D6" }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(melta[1]!.modifier.weapon_keyword).toBe("Melta");
  });

  it("reads a keyword the grant frame folded in a one-element keywords list", () => {
    const { keyword: _keyword, ...frame } = { subject: "this-unit", keyword: "x", weapon_type: "all" };
    const steps = mechanicsOf(TEXT, grant({ ...frame, keywords: ["Lethal Hits"] }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[1]!.modifier.weapon_keyword).toBe("Lethal Hits");
  });

  it("a duration between the condition and the threshold does not stop the fold", () => {
    const text = `${TEXT.replace("an unmodified", "until the end of the phase, an unmodified")}`;
    const mechanics = mechanicsOf(text, grant(), condition(), ["until the end of the phase", "duration", { endpoint: "end-of-phase" }], threshold());
    expect(JSON.stringify(mechanics)).toContain('"weapon_keyword":"Sustained Hits"');
  });

  it("refuses a condition with no earlier grant", () => {
    expect(refusalOf(TEXT, condition(), threshold())).toMatch(/no earlier keyword grant/u);
  });

  it("refuses a grant that gives two keywords", () => {
    expect(refusalOf(TEXT, grant({ keyword: undefined, keywords: ["Lethal Hits", "Precision"] }), condition(), threshold())).toMatch(/exactly one keyword/u);
  });

  it("refuses a grant that names a weapon, narrows by a weapon keyword or excludes weapons", () => {
    for (const narrowing of [{ weapon_name: "Zap cannon" }, { weapon_keyword: "Torrent" }, { incoming: true }, { exclude_weapon_keyword: ["Blast"] }]) {
      expect(refusalOf(TEXT, grant(narrowing), condition(), threshold())).toMatch(/cannot read a grant narrowed by/u);
    }
  });

  it("refuses a condition whose following sentence is not a critical-hit threshold", () => {
    const text = "Your unit's weapons have the [SUSTAINED HITS 1] ability. If such a weapon already has that ability, add 1 to its Attacks characteristic.";
    expect(refusalOf(text, grant(), condition(), ["add 1 to its Attacks characteristic", "characteristic-modifier", { characteristics: ["A"], operation: "add", value: 1, subject: "this-unit", weapon_type: "all" }]))
      .toMatch(/no already-has form for characteristic-modifier/u);
  });

  it("refuses a condition with nothing after it", () => {
    expect(refusalOf(TEXT, grant(), condition())).toMatch(/needs the sentence after it/u);
  });

  it("refuses two conditions for one sentence and a threshold that already selects weapons", () => {
    const twice = `${TEXT.replace("an unmodified", "if such a weapon already has that ability, an unmodified")}`;
    expect(refusalOf(twice, grant(), condition(), ["if such a weapon already has that ability", "weapon-has-ability", { weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "keep" }], threshold())).toMatch(/cannot share one sentence/u);
    expect(refusalOf(TEXT, grant(), condition(), threshold({ weapon_keyword: "Torrent" }))).toMatch(/already selects weapons/u);
  });

  it("without the condition the threshold stays unscoped, so only the fold ever adds the selection", () => {
    const steps = mechanicsOf(TEXT, grant(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[1]!.modifier).toEqual({ roll: "hit", critical_on: 5 });
  });
});

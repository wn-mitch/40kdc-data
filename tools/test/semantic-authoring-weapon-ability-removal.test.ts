import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/semantic-authoring/contracts.js";
import { SCOPE_WEAPON_KEYWORDS } from "../src/semantic-authoring/families/weapons.js";
import { describeEffect, type Effect } from "../src/translate/index.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../src/cruncher/buffs.js";
import { createValidator } from "../src/schema-loader.js";

/**
 * Weapon-ability removal ("Do not have [Heavy]") under a weapon-property scope, with the scope's
 * weapon_keyword selector. Wording is fabricated; each text places its leaves in order.
 */

/** Leaves on their own wording in `text`, in order (the same placement helper as the antecedent tests). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

function compiledEffect(text: string, list: CompileLeaf[]): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

function refusal(text: string, list: CompileLeaf[]): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected the compiler to refuse this clause");
  return result.errors.join("; ");
}

const ZETA = { owner: "friendly", all_of: ["ZETA"] };

describe("weapon-ability-removal family", () => {
  it("accepts a named value-less keyword, and Close-quarters from wave 9", () => {
    const version = currentFamilyVersion("weapon-ability-removal");
    expect(normalizeFingerprintParameters("weapon-ability-removal", { keyword: "Heavy" }, version)).toEqual({ keyword: "Heavy" });
    expect(normalizeFingerprintParameters("weapon-ability-removal", { keyword: "Close-quarters" }, version)).toEqual({ keyword: "Close-quarters" });
  });

  it("refuses a rated keyword, a blank or missing keyword, an unknown keyword and extra keys", () => {
    const version = currentFamilyVersion("weapon-ability-removal");
    for (const bad of [{ keyword: "Sustained Hits 1" }, { keyword: "Melta 2" }, { keyword: "" }, {}, { keyword: "Anti-Vehicle 4+" }, { keyword: "Heavy", weapon_type: "ranged" }]) {
      expect(() => normalizeFingerprintParameters("weapon-ability-removal", bad, version)).toThrow();
    }
  });
});

describe("weapon-property-scope version 4: weapon_keyword", () => {
  it("keeps version 3 unchanged", () => {
    expect(normalizeFingerprintParameters("weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }, 3))
      .toEqual({ subject: "this-unit", weapon_type: "ranged" });
  });

  it("selects by a weapon keyword with weapon_type required", () => {
    expect(normalizeFingerprintParameters("weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_keyword: "Blast" }, 4))
      .toEqual({ subject: "this-unit", weapon_type: "ranged", weapon_keyword: "Blast" });
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { subject: "this-unit", weapon_keyword: "Blast" }, 4)).toThrow();
  });

  it("refuses weapon_keyword with the bound weapon, and keywords outside the scope list", () => {
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { subject: "this-model", weapon: "antecedent", weapon_keyword: "Blast" }, 4)).toThrow();
    for (const keyword of ["Close-quarters", "Extra Attacks", "Melta", "Sustained Hits"]) {
      expect(() => normalizeFingerprintParameters("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_keyword: keyword }, 4)).toThrow();
    }
  });

  it("names the fifteen keywords that a removal and the scope both take", () => {
    expect([...SCOPE_WEAPON_KEYWORDS].sort()).toEqual([
      "Assault", "Blast", "Devastating Wounds", "Hazardous", "Heavy", "Ignores Cover", "Indirect Fire", "Lance", "Lethal Hits",
      "One Shot", "Pistol", "Precision", "Psychic", "Torrent", "Twin-linked",
    ]);
  });
});

describe("a removal under a scope compiles to the scope's weapons", () => {
  it("removes a keyword from ranged weapons and binds the roll to the scope's recipient", () => {
    // Fabricated analogue of: after a unit moves, its ranged weapons lose [HEAVY] and gain +1 to Hit.
    const text = "After a friendly ZETA unit makes a Normal move, that unit's ranged weapons: Do not have [Heavy]. Have +1 to Hit rolls.";
    const effect = compiledEffect(text, placed(text,
      ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["that unit's ranged weapons:", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
      ["Do not have [Heavy].", "weapon-ability-removal", { keyword: "Heavy" }],
      ["Have +1 to Hit rolls.", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ));
    expect(effect.steps).toEqual([
      { type: "weapon-ability-grant", target: ZETA, modifier: { removes: [{ keyword_id: "heavy" }], weapons: { type: "ranged" } } },
      { type: "roll-modifier", target: ZETA, modifier: { roll: "hit", operation: "add", value: 1, weapons: { type: "ranged" } } },
    ]);
  });

  it("selects the removed and improved weapons by the scope's keyword, as printed", () => {
    const text = "Your unit's Blast ranged weapons: Do not have [Blast]. Have +1 A.";
    const effect = compiledEffect(text, placed(text,
      ["Your unit's Blast ranged weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_keyword: "Blast" }],
      ["Do not have [Blast].", "weapon-ability-removal", { keyword: "Blast" }],
      ["Have +1 A.", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
    ));
    expect(effect.steps).toEqual([
      { type: "weapon-ability-grant", target: "this-unit", modifier: { removes: [{ keyword_id: "blast" }], weapons: { type: "ranged", keyword: { keyword_id: "blast" } } } },
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "ranged", keyword: { keyword_id: "blast" } } } },
    ]);
  });

  it("removes one keyword and grants another to the Torrent weapons, with the grant carrying the selector", () => {
    const text = "Your unit's Torrent weapons: Do not have [Blast]. Have [Close-Quarters]. Have +1 A.";
    const effect = compiledEffect(text, placed(text,
      ["Your unit's Torrent weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_keyword: "Torrent" }],
      ["Do not have [Blast].", "weapon-ability-removal", { keyword: "Blast" }],
      ["Have [Close-Quarters].", "weapon-ability-keyword", { keyword: "Close-quarters" }],
      ["Have +1 A.", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
    ));
    expect(effect.steps).toEqual([
      { type: "weapon-ability-grant", target: "this-unit", modifier: { removes: [{ keyword_id: "blast" }], weapons: { keyword: { keyword_id: "torrent" } } } },
      { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "close-quarters" }], weapons: { keyword: { keyword_id: "torrent" } } } },
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { keyword: { keyword_id: "torrent" } } } },
    ]);
  });
});

describe("the Gravis shape: a unit-activity antecedent", () => {
  it("scopes the removal and the roll to the unit that made the move", () => {
    const text = "After a friendly ZETA unit makes a Normal move this turn, that unit's ranged weapons: Do not have [Heavy]. Have +1 to Hit rolls.";
    const effect = compiledEffect(text, placed(text,
      ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["makes a Normal move this turn", "unit-activity", { activities: ["made-normal-move-this-turn"], subject: "antecedent", negated: false }],
      ["that unit's ranged weapons:", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
      ["Do not have [Heavy].", "weapon-ability-removal", { keyword: "Heavy" }],
      ["Have +1 to Hit rolls.", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ));
    // The move's unit gates both effects, and both reach the friendly units the filter names.
    const gate = { type: "happened", parameters: { subject: "recipient", event: "move-ended", filter: { move_types: ["normal"] }, window: "turn" } };
    expect(effect.steps).toEqual([
      { type: "conditional", condition: gate, effect: { type: "weapon-ability-grant", target: ZETA, modifier: { removes: [{ keyword_id: "heavy" }], weapons: { type: "ranged" } } } },
      { type: "conditional", condition: gate, effect: { type: "roll-modifier", target: ZETA, modifier: { roll: "hit", operation: "add", value: 1, weapons: { type: "ranged" } } } },
    ]);
  });
});

describe("the Gravis shape with the printed In-a-turn wording", () => {
  it("binds the removal and the roll to the unit that made the normal move in the turn", () => {
    const text = "In a turn a friendly ZETA unit made a Normal move, that unit's ranged weapons: Do not have [Heavy]. Have +1 to Hit rolls.";
    const effect = compiledEffect(text, placed(text,
      ["a friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["made a Normal move", "unit-activity", { activities: ["made-normal-move-this-turn"], subject: "antecedent", negated: false }],
      ["that unit's ranged weapons:", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
      ["Do not have [Heavy].", "weapon-ability-removal", { keyword: "Heavy" }],
      ["Have +1 to Hit rolls.", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ));
    const gate = { type: "happened", parameters: { subject: "recipient", event: "move-ended", filter: { move_types: ["normal"] }, window: "turn" } };
    expect(effect.steps).toEqual([
      { type: "conditional", condition: gate, effect: { type: "weapon-ability-grant", target: ZETA, modifier: { removes: [{ keyword_id: "heavy" }], weapons: { type: "ranged" } } } },
      { type: "conditional", condition: gate, effect: { type: "roll-modifier", target: ZETA, modifier: { roll: "hit", operation: "add", value: 1, weapons: { type: "ranged" } } } },
    ]);
  });
});

describe("the Blast-scoped shape: an engaged trigger filter over a removal", () => {
  it("gates the removal and the stat change on the engaged unit selected to shoot", () => {
    const text = "In your Shooting phase, when a friendly engaged IMPERIAL KNIGHTS DOMINUS unit is selected to shoot. That unit. Your unit's Blast ranged weapons: Do not have [Blast]. Have +1 A.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["a friendly", "unit-filter", { side: "friendly", keywords: ["IMPERIAL KNIGHTS", "DOMINUS"] }],
      ["engaged", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false }],
      ["is selected to shoot", "event", { kind: "selected", to: "shoot" }],
      ["That unit.", "triggering-target", { selects: "unit", keywords: ["IMPERIAL KNIGHTS", "DOMINUS"], match: "all" }],
      ["Your unit's Blast ranged weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_keyword: "Blast" }],
      ["Do not have [Blast].", "weapon-ability-removal", { keyword: "Blast" }],
      ["Have +1 A.", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as unknown as Record<string, any>;
    expect(mechanics.trigger.subject).toEqual({ owner: "friendly", all_of: ["DOMINUS", "IMPERIAL KNIGHTS"] });
    expect(mechanics.effect.condition).toEqual({ type: "matches", parameters: { subject: "event-subject", filter: { state: "engaged" } } });
    expect(mechanics.effect.effect.steps).toEqual([
      { type: "weapon-ability-grant", target: "this-unit", modifier: { removes: [{ keyword_id: "blast" }], weapons: { type: "ranged", keyword: { keyword_id: "blast" } } } },
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "ranged", keyword: { keyword_id: "blast" } } } },
    ]);
  });
});

describe("a removal under a scope refuses what it cannot bind", () => {
  it("refuses a removal with no scope before it", () => {
    const text = "Do not have [Heavy].";
    expect(refusal(text, placed(text, ["Do not have [Heavy].", "weapon-ability-removal", { keyword: "Heavy" }])))
      .toContain("no recipient");
  });

  it("refuses a keyword the same clause both removes and grants", () => {
    const text = "Your unit's ranged weapons: Do not have [Blast]. Have [Blast].";
    expect(refusal(text, placed(text,
      ["Your unit's ranged weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
      ["Do not have [Blast].", "weapon-ability-removal", { keyword: "Blast" }],
      ["Have [Blast].", "weapon-ability-keyword", { keyword: "Blast" }],
    ))).toContain("both removed and granted");
  });

  it("refuses a removal under the bound-weapon scope", () => {
    const text = "Select one of this model's Plasma rifle weapons. That weapon's attacks: Do not have [Heavy].";
    expect(refusal(text, placed(text,
      ["Select one of this model's Plasma rifle weapons.", "select-weapon", { target: "this-model", weapon_name: "Plasma rifle", bind_as: "w" }],
      ["That weapon's attacks:", "weapon-property-scope", { subject: "this-model", weapon: "antecedent" }],
      ["Do not have [Heavy].", "weapon-ability-removal", { keyword: "Heavy" }],
    ))).toContain("stat adjustments only");
  });

  it("refuses a removal offered as one option of a choice with a stat change", () => {
    const text = "Your unit's ranged weapons: Do not have [Heavy]. Or: Have +1 A.";
    expect(refusal(text, placed(text,
      ["Your unit's ranged weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
      ["Do not have [Heavy].", "weapon-ability-removal", { keyword: "Heavy" }],
      ["Have +1 A.", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
    ))).toContain("explicit composition relation");
  });

  it("refuses a scope that names one weapon by name, so a removal cannot be scoped to one weapon", () => {
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_name: "Plasma rifle" }, 4)).toThrow();
  });

  it("refuses a subjectless hit roll in an alternative after a scope, which would land on this unit's own attacks", () => {
    // Fabricated analogue of a defender-side option: the -1 names attacks that target the unit, which
    // no scope binds, so the compiler must not default it to this unit's own weapons.
    const text = "Your unit's melee weapons: Have +1 to Hit rolls. Or: Attacks that target this unit have -1 to Hit rolls.";
    expect(refusal(text, placed(text,
      ["Your unit's melee weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
      ["Have +1 to Hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["Attacks that target this unit have -1 to Hit rolls.", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }],
    ))).toContain("names no recipient");
  });

  it("refuses a hit roll under a keyword scope, which the DSL roll modifier cannot select", () => {
    const text = "Your unit's Blast weapons: Have +1 to Hit rolls.";
    expect(refusal(text, placed(text,
      ["Your unit's Blast weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_keyword: "Blast" }],
      ["Have +1 to Hit rolls.", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ))).toContain("keyword");
  });
});

describe("describer and cruncher for removals", () => {
  it("describes a removal with a weapon type as the weapons losing the ability", () => {
    expect(describeEffect({ type: "weapon-ability-grant", target: "this-unit", modifier: { removes: [{ keyword_id: "heavy" }], weapons: { type: "ranged" } } } as unknown as Effect))
      .toBe("Ranged weapons equipped by models in this unit lose [HEAVY].");
  });

  it("describes a keyword selector in both sentences of a Blast removal and stat change", () => {
    const removal = describeEffect({ type: "weapon-ability-grant", target: "this-unit", modifier: { removes: [{ keyword_id: "blast" }], weapons: { type: "ranged", keyword: { keyword_id: "blast" } } } } as unknown as Effect);
    const stat = describeEffect({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "ranged", keyword: { keyword_id: "blast" } } } } as unknown as Effect);
    expect(removal).toBe("Ranged weapons with [BLAST] equipped by models in this unit lose [BLAST].");
    expect(stat).toBe("Improve the Attacks characteristic of ranged weapons with [BLAST] equipped by models in this unit by 1.");
  });

  it("refuses a removal as unsupported in the cruncher and gates a keyword selector on that keyword", () => {
    const source: BuffSource = { kind: "ability", abilityId: "zeta-rule", abilityKind: "unit" };
    const ctx: EngineContext = { phase: "shooting", attackerStationary: false };
    const removal = effectToBuffs({ type: "weapon-ability-grant", target: "this-unit", modifier: { removes: [{ keyword_id: "heavy" }], weapons: { type: "ranged" } } }, source, ctx, "attacker");
    expect(removal.applied).toEqual([]);
    expect(removal.unsupported.map((entry) => entry.reason)).toEqual([
      'weapon-ability-removal: the cruncher does not model removing a weapon ability ("Heavy")',
    ]);
    const selector = effectToBuffs({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "close-quarters" }], weapons: { keyword: { keyword_id: "torrent" } } } }, source, ctx, "attacker");
    expect(selector.unsupported).toEqual([]);
    expect(selector.applied.map((buff) => buff.applicableWhen)).toEqual([{ weaponKeywords: [{ keyword_id: "torrent" }] }]);
  });
});

describe("the effect schema accepts a removal with or without keywords", () => {
  const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
  const grant = (modifier: Record<string, unknown>) => ({ type: "weapon-ability-grant", target: "this-unit", modifier });

  it("accepts removes alone, and keywords with removes", () => {
    expect(validate(grant({ removes: [{ keyword_id: "heavy" }], weapons: { type: "ranged" } }))).toBe(true);
    expect(validate(grant({ keywords: [{ keyword_id: "close-quarters" }], removes: [{ keyword_id: "blast" }], weapons: { keyword: { keyword_id: "torrent" } } }))).toBe(true);
  });

  it("refuses a grant with neither list, an empty removes, and a duplicate keyword in removes", () => {
    expect(validate(grant({ weapons: { type: "ranged" } }))).toBe(false);
    expect(validate(grant({ removes: [] }))).toBe(false);
    expect(validate(grant({ removes: [{ keyword_id: "heavy" }, { keyword_id: "heavy" }] }))).toBe(false);
  });
});

/**
 * "If such a weapon already has that ability": the condition after a keyword grant, folded into the
 * critical-hit threshold after it. Every sentence below is fabricated.
 */

type Piece = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves on their wording in `text`, in order, with their parameters as written (not normalized). */
function placedAsWritten(text: string, ...pieces: Piece[]): CompileLeaf[] {
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
  return compileLeaves(placedAsWritten(text, ...pieces), text);
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
    expect(steps[0]).toMatchObject({ type: "weapon-ability-grant", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] } });
    expect(steps[0]!.modifier.if_present).toBeUndefined();
    expect(steps[1]).toMatchObject({ type: "roll-result", modifier: { roll: "hit", critical_on: 5, weapons: { keyword: { keyword_id: "sustained-hits" } } } });
    expect(steps[1]!.modifier.weapons).toBeDefined();
  });

  it("add: the grant raises a rating the weapon already has", () => {
    const steps = mechanicsOf(TEXT, grant(), condition("add"), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[0]!.modifier.if_present).toBe("increment");
    expect(steps[1]!.modifier.weapons).toMatchObject({ keyword: { keyword_id: "sustained-hits" } });
  });

  it("a ranged grant puts the weapon type on the roll result", () => {
    const steps = mechanicsOf(TEXT, grant({ weapon_type: "ranged" }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[1]!.modifier).toMatchObject({ weapons: { type: "ranged", keyword: { keyword_id: "sustained-hits" } } });
  });

  it("strips a numeric threshold rating and a dice rating from the keyword", () => {
    const anti = mechanicsOf(TEXT, grant({ keyword: "Anti-Infantry 5+" }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(anti[1]!.modifier.weapons).toEqual({ keyword: { keyword_id: "anti", parameters: { target_keyword: "INFANTRY" } } });
    const melta = mechanicsOf(TEXT, grant({ keyword: "Melta D6" }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(melta[1]!.modifier.weapons).toMatchObject({ keyword: { keyword_id: "melta" } });
  });

  it("reads a keyword the grant frame folded in a one-element keywords list", () => {
    const { keyword: _keyword, ...frame } = { subject: "this-unit", keyword: "x", weapon_type: "all" };
    const steps = mechanicsOf(TEXT, grant({ ...frame, keywords: ["Lethal Hits"] }), condition(), threshold()).effect.steps as Array<Record<string, any>>;
    expect(steps[1]!.modifier.weapons).toEqual({ keyword: { keyword_id: "lethal-hits" } });
  });

  it("a duration between the condition and the threshold does not stop the fold", () => {
    const text = `${TEXT.replace("an unmodified", "until the end of the phase, an unmodified")}`;
    const mechanics = mechanicsOf(text, grant(), condition(), ["until the end of the phase", "duration", { endpoint: "end-of-phase" }], threshold());
    expect(JSON.stringify(mechanics)).toContain('"keyword_id":"sustained-hits"');
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

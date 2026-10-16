import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/families/index.js";
import { mergedFilter } from "../src/round5c/compile-unit-filters.js";
import { createValidator } from "../src/schema-loader.js";

/** The family versions the extensions under test create. */
const DICE_COUNT_CAP_AND_TABLES_VERSIONS: ReadonlySet<string> = new Set(["dice-roll@6", "reroll@7", "roll-modifier@9", "roll-auto-result@4", "characteristic-set@9"]);

type Item = [string, string, Record<string, unknown>, string?, string?];

/**
 * Leaves placed by their wording in `text`, in order (fabricated wording, not rules text). An item whose
 * fifth entry is "in" sits inside the span of the item before it (a contained leaf under allow_overlap).
 */
function compileItems(text: string, items: Item[]) {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  let innerFrom = 0;
  const leaves: CompileLeaf[] = items.map(([wording, family, parameters, fragment, mode]) => {
    const inner = mode === "in";
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), inner ? innerFrom : from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    if (inner) innerFrom = end;
    else { from = end; innerFrom = start; }
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment: fragment ?? "RAW_TEXT", ...(inner ? { allow_overlap: true } : {}) } as CompileLeaf;
  });
  return compileLeaves(leaves, text);
}

function mechanicsOf(text: string, items: Item[]): Record<string, any> {
  const result = compileItems(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, items: Item[]): string[] {
  const result = compileItems(text, items);
  return result.ok ? [] : result.errors;
}

/** The version just before this bundle's extension of `family`; later extensions may sit above it. */
const PREVIOUS = (family: string) => {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && DICE_COUNT_CAP_AND_TABLES_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
  }
  throw new Error(`The dice bundle does not extend ${family}.`);
};
/** The version this bundle's extension of `family` defines. */
const OWN = (family: string) => PREVIOUS(family) + 1;
const normalize = (family: string, parameters: Record<string, unknown>, version = currentFamilyVersion(family)) => normalizeFingerprintParameters(family, parameters, version);

function validates(effect: unknown): void {
  const validate = createValidator().compile({ $ref: "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node" });
  expect(validate(effect), JSON.stringify(validate.errors?.slice(0, 2))).toBe(true);
}

describe("family versions (each widens only)", () => {
  it("characteristic-set takes a dice value for A, S and D only", () => {
    const leaf = { subject: "this-unit", characteristic: "A", value: "D3+3", weapon_type: "ranged" };
    expect(normalize("characteristic-set", leaf, OWN("characteristic-set"))).toEqual(leaf);
    expect(normalize("characteristic-set", { ...leaf, characteristic: "S", value: "D6" }, OWN("characteristic-set"))).toMatchObject({ value: "D6" });
    expect(() => normalize("characteristic-set", leaf, PREVIOUS("characteristic-set"))).toThrow();
    expect(() => normalize("characteristic-set", { ...leaf, characteristic: "M", weapon_type: undefined }, OWN("characteristic-set"))).toThrow(/only A, S and D/u);
    expect(() => normalize("characteristic-set", { ...leaf, value: "D4" }, OWN("characteristic-set"))).toThrow();
    expect(() => normalize("characteristic-set", { ...leaf, value: "fast" }, OWN("characteristic-set"))).toThrow();
  });

  it("characteristic-set still takes every value the previous version took", () => {
    for (const value of [3, { source: "the unit's rating" }]) {
      const leaf = { subject: "this-unit", characteristic: "A", value, weapon_type: "all" };
      expect(normalize("characteristic-set", leaf, PREVIOUS("characteristic-set"))).toEqual(leaf);
      expect(normalize("characteristic-set", leaf, OWN("characteristic-set"))).toEqual(leaf);
    }
  });

  it("reroll counts up to 12 and refuses 13 and 0", () => {
    const leaf = { roll: "hit", subset: "all", weapon_type: "all" };
    expect(normalize("reroll", { ...leaf, count: 6 }, OWN("reroll"))).toEqual({ ...leaf, count: 6 });
    expect(normalize("reroll", { ...leaf, count: 12 }, OWN("reroll"))).toMatchObject({ count: 12 });
    expect(() => normalize("reroll", { ...leaf, count: 6 }, PREVIOUS("reroll"))).toThrow();
    expect(() => normalize("reroll", { ...leaf, count: 13 }, OWN("reroll"))).toThrow();
    expect(() => normalize("reroll", { ...leaf, count: 0 }, OWN("reroll"))).toThrow();
    expect(() => normalize("reroll", { ...leaf, count: 2.5 }, OWN("reroll"))).toThrow();
  });

  it("reroll still takes counts 1 to 3 and no count", () => {
    const leaf = { roll: "hit", subset: "failed", weapon_type: "all" };
    for (const count of [1, 2, 3, undefined]) {
      const input = count === undefined ? leaf : { ...leaf, count };
      expect(normalize("reroll", input, PREVIOUS("reroll"))).toEqual(input);
      expect(normalize("reroll", input, OWN("reroll"))).toEqual(input);
    }
  });

  it("roll-modifier cap needs a numeric added value on one roll", () => {
    const leaf = { roll: "psychic", operation: "add", value: 1, cap: 2 };
    expect(normalize("roll-modifier", leaf, OWN("roll-modifier"))).toEqual(leaf);
    expect(() => normalize("roll-modifier", leaf, PREVIOUS("roll-modifier"))).toThrow();
    expect(() => normalize("roll-modifier", { ...leaf, value: { source: "a count" } }, OWN("roll-modifier"))).toThrow(/numeric value/u);
    expect(() => normalize("roll-modifier", { ...leaf, operation: "subtract" }, OWN("roll-modifier"))).toThrow(/operation add/u);
    expect(() => normalize("roll-modifier", { operation: "add", value: 1, rolls: ["hit", "wound"], cap: 2 }, OWN("roll-modifier"))).toThrow(/single roll/u);
    expect(() => normalize("roll-modifier", { ...leaf, cap: 0 }, OWN("roll-modifier"))).toThrow();
    expect(() => normalize("roll-modifier", { ...leaf, cap: 13 }, OWN("roll-modifier"))).toThrow();
  });

  it("roll-modifier still takes a leaf without a cap", () => {
    for (const leaf of [{ roll: "hit", operation: "add", value: 1 }, { roll: "wound", operation: "subtract", value: { source: "the count" } }]) {
      expect(normalize("roll-modifier", leaf, PREVIOUS("roll-modifier"))).toEqual(leaf);
      expect(normalize("roll-modifier", leaf, OWN("roll-modifier"))).toEqual(leaf);
    }
  });

  it("roll-auto-result fails-on takes a value from 1 to 5 and one roll", () => {
    const leaf = { roll: "hit", outcome: "fails-on", value: 3 };
    expect(normalize("roll-auto-result", leaf, OWN("roll-auto-result"))).toEqual(leaf);
    expect(normalize("roll-auto-result", { ...leaf, value: 1 }, OWN("roll-auto-result"))).toMatchObject({ value: 1 });
    expect(() => normalize("roll-auto-result", leaf, PREVIOUS("roll-auto-result"))).toThrow();
    expect(() => normalize("roll-auto-result", { ...leaf, value: 6 }, OWN("roll-auto-result"))).toThrow();
    expect(() => normalize("roll-auto-result", { ...leaf, value: 0 }, OWN("roll-auto-result"))).toThrow();
    expect(() => normalize("roll-auto-result", { roll: "hit", outcome: "fails-on" }, OWN("roll-auto-result"))).toThrow();
    expect(() => normalize("roll-auto-result", { rolls: ["hit", "wound"], outcome: "fails-on", value: 3, count: 1 }, OWN("roll-auto-result"))).toThrow();
  });

  it("roll-auto-result still takes every outcome the previous version took", () => {
    for (const leaf of [{ roll: "hit", outcome: "auto-pass" }, { roll: "hit", outcome: "counts-as-6" }, { roll: "save", outcome: "succeeds-on", value: 4 }]) {
      expect(normalize("roll-auto-result", leaf, PREVIOUS("roll-auto-result"))).toEqual(leaf);
      expect(normalize("roll-auto-result", leaf, OWN("roll-auto-result"))).toEqual(leaf);
    }
    expect(() => normalize("roll-auto-result", { roll: "hit", outcome: "auto-pass", value: 3 }, OWN("roll-auto-result"))).toThrow();
  });

  it("dice-roll alternative is true with a count or per model, never with a roll_var", () => {
    expect(normalize("dice-roll", { dice: "D6", count: 4, alternative: true }, OWN("dice-roll"))).toEqual({ dice: "D6", count: 4, alternative: true });
    expect(normalize("dice-roll", { dice: "D6", per_model: "this-unit", alternative: true }, OWN("dice-roll"))).toMatchObject({ alternative: true });
    expect(() => normalize("dice-roll", { dice: "D6", count: 4, alternative: true }, PREVIOUS("dice-roll"))).toThrow();
    expect(() => normalize("dice-roll", { dice: "D6", alternative: false }, OWN("dice-roll"))).toThrow();
    expect(() => normalize("dice-roll", { dice: "D6", alternative: true, roll_var: "pool" }, OWN("dice-roll"))).toThrow();
    expect(() => normalize("dice-roll", { dice: "D6", count: 1, alternative: true }, OWN("dice-roll"))).toThrow();
  });

  it("dice-roll still takes every shape the previous version took", () => {
    for (const leaf of [{ dice: "D6" }, { dice: "D3", count: 3 }, { dice: "D6", per_model: "target" }, { dice: "D6", roll_var: "pool" }]) {
      expect(normalize("dice-roll", leaf, PREVIOUS("dice-roll"))).toEqual(leaf);
      expect(normalize("dice-roll", leaf, OWN("dice-roll"))).toEqual(leaf);
    }
  });
});

describe("S2 compile lines", () => {
  it("compiles a dice-valued setter to a stat-modifier with the dice string", () => {
    const mechanics = mechanicsOf("This unit's Zorb Launcher weapons have D3+3 A.", [
      ["This unit's Zorb Launcher weapons have D3+3 A", "characteristic-set", { subject: "this-unit", characteristic: "A", value: "D3+3", weapon_type: "ranged", weapon_name: "Zorb Launcher" }],
    ]);
    expect(mechanics.effect.modifier).toMatchObject({ stat: "A", operation: "set", value: "D3+3", weapons: { type: "ranged", name: "Zorb Launcher" } });
    validates(mechanics.effect);
  });

  it("compiles a re-roll of six dice", () => {
    const mechanics = mechanicsOf("Re-roll up to six of the dice.", [["Re-roll up to six of the dice", "reroll", { roll: "hit", subset: "all", count: 6, weapon_type: "all" }]]);
    expect(mechanics.effect.modifier.count).toBe(6);
  });

  it("compiles a capped modifier with the cap on the DSL modifier", () => {
    const mechanics = mechanicsOf("Add 1 to the Zorb test result (to a maximum of +2).", [
      ["Add 1 to the Zorb test result (to a maximum of +2)", "roll-modifier", { roll: "psychic", operation: "add", value: 1, cap: 2 }],
    ]);
    expect(mechanics.effect.modifier).toMatchObject({ roll: "psychic", operation: "add", value: 1, cap: 2 });
    validates(mechanics.effect);
  });

  it("compiles fails-on to the attacker's roll only when an attack leaf names the attacker", () => {
    const text = "Ranged attacks that target this unit fail on an unmodified hit roll of 1-3.";
    const fail: Item = ["fail on an unmodified hit roll of 1-3", "roll-auto-result", { roll: "hit", outcome: "fails-on", value: 3 }];
    const authored = mechanicsOf(text, [["Ranged attacks that target this unit", "attack", { direction: "targeted", unit: "this-unit", attack_type: "ranged" }], fail]);
    expect(authored.effect.effect).toMatchObject({ type: "roll-result", target: "attacker", modifier: { roll: "hit", fails_on: 3 } });
    expect(authored.effect.effect.modifier.result).toBeUndefined();
    validates(authored.effect);
    const bare = mechanicsOf(text, [["Ranged attacks that target this unit", "attack-filter", { attack_type: "ranged" }], fail]);
    expect(bare.effect.effect.target).toBe("this-unit");
  });
});

const POOL_SELECT: Item = ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }];
const POOL_ENGAGED: Item = ["within Engagement Range of your unit", "unit-state", { states: ["engaged"], subject: "selected-unit", with: "this-unit" }];
const HAS = (keyword: string): Record<string, unknown> => ({ keywords: [keyword], subject: "this-unit", negated: false });
const POOL_TEXT = "Select one enemy unit within Engagement Range of your unit. Roll one D6 for each Zorb model in your unit, or roll four D6 if your unit has the Alpha keyword, or roll six D6 if your unit has the Omega keyword: for each 3+, that enemy unit suffers 1 mortal wound.";
const POOL_ITEMS: Item[] = [
  POOL_SELECT, POOL_ENGAGED,
  ["Roll one D6", "dice-roll", { dice: "D6" }],
  ["for each", "for-each-unit-select", {}],
  ["Zorb model", "unit-filter", { side: "friendly", keywords: ["ZORB"], level: "model" }],
  ["in your unit", "membership", { relation: "in", of: "this-unit" }],
  [", or roll four D6", "dice-roll", { dice: "D6", count: 4, alternative: true }],
  ["if your unit has the Alpha keyword", "unit-keyword", HAS("ALPHA")],
  ["or roll six D6", "dice-roll", { dice: "D6", count: 6, alternative: true }],
  ["if your unit has the Omega keyword", "unit-keyword", HAS("OMEGA")],
  ["for each 3+", "roll-result", { from: 3 }],
  ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
];

describe("S4 alternative dice pools", () => {
  it("makes one conditional per pool: the base when no alternative holds, then each alternative", () => {
    const mechanics = mechanicsOf(POOL_TEXT, POOL_ITEMS);
    const steps = mechanics.effect.effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(3);
    expect(steps[0]!.condition.operator).toBe("not");
    expect(steps[0]!.condition.operands[0].operator).toBe("or");
    expect(steps[0]!.condition.operands[0].operands).toHaveLength(2);
    expect(steps[0]!.effect.modifier.roll).toMatchObject({ dice: 1, threshold: 3 });
    expect(steps[0]!.effect.modifier.roll.for_each).toMatchObject({ filter: { owner: "friendly", all_of: ["ZORB"], level: "model", member_of: "this-unit" } });
    expect(steps[1]!.condition.parameters.filter.all_of).toEqual(["ALPHA"]);
    expect(steps[1]!.effect.modifier.roll).toMatchObject({ dice: 4, threshold: 3 });
    expect(steps[2]!.condition.parameters.filter.all_of).toEqual(["OMEGA"]);
    expect(steps[2]!.effect.modifier.roll).toMatchObject({ dice: 6, threshold: 3 });
    validates(mechanics.effect);
  });

  it("with one alternative the base is the plain negation", () => {
    const items = POOL_ITEMS.filter((item) => !["or roll six D6", "if your unit has the Omega keyword"].includes(item[0]));
    const steps = mechanicsOf(POOL_TEXT.replace(", or roll six D6 if your unit has the Omega keyword", ""), items).effect.effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.condition).toMatchObject({ operator: "not", operands: [{ type: "matches", parameters: { filter: { all_of: ["ALPHA"] } } }] });
  });

  it("refuses an alternative roll with no condition leaf after it", () => {
    const items = POOL_ITEMS.filter((item) => item[0] !== "if your unit has the Omega keyword");
    const errors = errorsOf(POOL_TEXT.replace(" if your unit has the Omega keyword", ""), items);
    expect(errors.join(" ")).toMatch(/no condition leaf follows/u);
  });

  it("refuses an alternative roll with no roll before it", () => {
    const items: Item[] = [
      ["roll four D6", "dice-roll", { dice: "D6", count: 4, alternative: true }],
      ["if your unit has the Alpha keyword", "unit-keyword", HAS("ALPHA")],
      ["for each 3+", "roll-result", { from: 3 }],
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
    ];
    expect(errorsOf("Roll four D6 if your unit has the Alpha keyword: for each 3+, that enemy unit suffers 1 mortal wound.".replace("Roll", "roll"), items).join(" ")).toMatch(/no roll comes before it/u);
  });

  it("refuses pools when an effect in the part is not decided by the dice", () => {
    const items: Item[] = [...POOL_ITEMS, ["this unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "2" }]];
    expect(errorsOf(`${POOL_TEXT} Then this unit suffers 2 mortal wounds.`, items).length).toBeGreaterThan(0);
  });

  it("a 7566 shape keeps its alternative when the roll leaf's span ends in instead", () => {
    const text = "Select one enemy unit within Engagement Range of your unit. Roll one D6 for each Zorb model in your unit that is within Engagement Range of that enemy unit, or roll six D6 instead if your unit is a Beast unit: for each 4+, that enemy unit suffers 1 mortal wound.";
    const mechanics = mechanicsOf(text, [
      POOL_SELECT, POOL_ENGAGED,
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["Zorb model", "unit-filter", { side: "friendly", level: "model", keywords: ["ZORB"] }],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      ["that is within Engagement Range of that enemy unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "antecedent" }],
      [", or roll six D6 instead", "dice-roll", { dice: "D6", count: 6, alternative: true }],
      ["if your unit is a Beast unit", "unit-keyword", HAS("BEAST")],
      ["for each 4+", "roll-result", { from: 4 }],
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
    ]);
    const steps = mechanics.effect.effect.steps as Array<Record<string, any>>;
    expect(steps[0]!.condition).toMatchObject({ operator: "not", operands: [{ type: "matches", parameters: { filter: { all_of: ["BEAST"] } } }] });
    expect(steps[0]!.effect.modifier.roll.for_each.eligibility ?? steps[0]!.effect.modifier.roll.for_each).toBeDefined();
    expect(steps[1]!.effect.modifier.roll).toMatchObject({ dice: 6, threshold: 4 });
    validates(mechanics.effect);
  });
});

const GLIDE_TEXT = "Select one enemy unit. Roll two D6, adding 1 to each result if that enemy unit can Glide: for each 4+, that enemy unit suffers D3 mortal wounds.";
const glideItems = (roll: Record<string, unknown>, bonus = 1, from = 4): Item[] => [
  POOL_SELECT,
  ["Roll two D6", "dice-roll", roll],
  [`adding ${bonus} to each result`, "roll-modifier", { roll: "preceding", operation: "add", value: bonus }],
  ["if that enemy unit can Glide", "unit-keyword", { keywords: ["GLIDE"], subject: "antecedent", negated: false }],
  [`for each ${from}+`, "roll-result", { from }],
  ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
];

describe("S5 conditional bonus on a roll of several dice", () => {
  it("shifts the per-die threshold on the yes side only", () => {
    const mechanics = mechanicsOf(GLIDE_TEXT, glideItems({ dice: "D6", count: 2 }));
    const steps = mechanics.effect.effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.condition).toMatchObject({ type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["GLIDE"] } } });
    expect(steps[0]!.effect.modifier).toMatchObject({ count: "D3", per: "success", roll: { dice: 2, threshold: 3 } });
    expect(steps[1]!.condition.operator).toBe("not");
    expect(steps[1]!.effect.modifier.roll).toMatchObject({ dice: 2, threshold: 4 });
    validates(mechanics.effect);
  });

  it("refuses a bonus that makes a band succeed on every face", () => {
    const errors = errorsOf(GLIDE_TEXT.replace("adding 1", "adding 3").replace("4+", "3+"), glideItems({ dice: "D6", count: 2 }, 3, 3));
    expect(errors.join(" ")).toMatch(/succeed on every face/u);
  });

  it("refuses the same bonus on a per-model roll (the per-model ruling stands)", () => {
    expect(errorsOf(GLIDE_TEXT, glideItems({ dice: "D6", per_model: "this-unit" }))).toEqual(["A conditional change to a roll of several dice has no DSL shape."]);
  });

  it("refuses an unconditional bonus on several dice", () => {
    const text = "Select one enemy unit. Roll two D6, adding 1 to each result: for each 4+, that enemy unit suffers D3 mortal wounds.";
    const items = glideItems({ dice: "D6", count: 2 }).filter((item) => item[1] !== "unit-keyword");
    expect(errorsOf(text, items).length).toBeGreaterThan(0);
  });

  it("a for-each-unit roll with a conditional bonus builds the two tables inside the loop", () => {
    const text = "Roll one D6 for each enemy unit within 6\" of this unit, adding 2 to the result if that unit has the Glide keyword: on a 2-3, that enemy unit suffers D3 mortal wounds; on a 4+, that enemy unit suffers 3 mortal wounds.";
    const mechanics = mechanicsOf(text, [
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this unit", "unit-state", { states: ["engaged"], subject: "antecedent", with: "this-unit" }],
      [", adding 2 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 2 }],
      ["if that unit has the Glide keyword", "unit-keyword", { keywords: ["GLIDE"], subject: "antecedent", negated: false }],
      ["on a 2-3", "roll-result", { from: 2, to: 3 }],
      ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
      ["on a 4+", "roll-result", { from: 4 }],
      ["that enemy unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }],
    ]);
    expect(mechanics.effect.type).toBe("for-each-unit");
    const [yes, no] = mechanics.effect.effect.steps as Array<Record<string, any>>;
    const faces = (step: Record<string, any>) => step.effect.outcomes.map((outcome: any) => [outcome.results, outcome.effect.type === "no-effect" ? "none" : outcome.effect.modifier.count]);
    expect(faces(yes!)).toEqual([[[1], "D3"], [[2, 3, 4, 5, 6], 3]]);
    expect(faces(no!)).toEqual([[[1], "none"], [[2, 3], "D3"], [[4, 5, 6], 3]]);
    validates(mechanics.effect);
  });
});

describe("S6 loop scope", () => {
  const loop: Item[] = [
    ["Roll one D6", "dice-roll", { dice: "D6" }],
    ["for each", "for-each-unit-select", {}],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6\" of this unit", "unit-state", { states: ["engaged"], subject: "antecedent", with: "this-unit" }],
    ["on a 4+", "roll-result", { from: 4 }],
    ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
  ];
  const head = "Roll one D6 for each enemy unit within 6\" of this unit: on a 4+, that enemy unit suffers D3 mortal wounds.";

  it("a later sentence's effect on the bearer's unit runs once, after the loop", () => {
    const mechanics = mechanicsOf(`${head} Then, this unit suffers 3D3 mortal wounds.`, [...loop, ["this unit suffers 3D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "3D3" }]]);
    expect(mechanics.effect.type).toBe("sequence");
    expect(mechanics.effect.steps[0].type).toBe("for-each-unit");
    expect(mechanics.effect.steps[1]).toMatchObject({ type: "mortal-wounds", target: "this-unit", modifier: { count: "3D3" } });
    validates(mechanics.effect);
  });

  it("a later sentence with its own roll band on the bearer's unit is refused, never a raw marker", () => {
    const text = `${head} On a 6, this unit suffers 2 mortal wounds.`;
    const result = compileItems(text, [...loop, ["On a 6", "roll-result", { from: 6 }], ["this unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "2" }]]);
    expect(result.ok ? JSON.stringify(result.mechanics) : "").not.toContain("__roll-result");
    expect(result.ok).toBe(false);
  });

  it("a bearer roll-modifier in a later sentence stays in the loop's own sequence (pinned; not hoisted after it)", () => {
    const text = `${head} Then, add 1 to hit rolls made by this unit.`;
    const result = compileItems(text, [...loop, ["add 1 to hit rolls made by this unit", "roll-modifier", { operation: "add", value: 1, rolls: ["hit"], recipient: "this-unit" }]]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = (result.mechanics as unknown as Record<string, any>).effect;
    expect(effect.type).toBe("for-each-unit");
    expect(effect.effect.steps.map((step: any) => step.type)).toEqual(["dice-gated", "roll-modifier"]);
  });

  it("a later sentence's effect on the iterated unit stays inside the loop", () => {
    const mechanics = mechanicsOf(`${head} Then, that enemy unit suffers 2 mortal wounds.`, [...loop, ["that enemy unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2" }]]);
    expect(mechanics.effect.type).toBe("for-each-unit");
    expect(mechanics.effect.effect.steps).toHaveLength(2);
  });
});

describe("S7 per-model roll that narrows its models", () => {
  const body = (wording: string): Item[] => [
    POOL_SELECT,
    [wording, "dice-roll", { dice: "D6", per_model: "this-unit" }],
    ["on a 4+", "roll-result", { from: 4 }],
    ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
  ];
  const text = (wording: string) => `Select one enemy unit. ${wording}: on a 4+, that enemy unit suffers 1 mortal wound.`;

  it("still compiles a roll for every model of the unit", () => {
    const wording = "Roll one D6 for each model in this unit";
    expect(mechanicsOf(text(wording), body(wording)).effect.effect.modifier.roll.per_model).toBe("this-unit");
  });

  it("refuses wording that narrows the models", () => {
    for (const wording of [
      "Roll one D6 for each model in this unit that is engaged with that enemy unit",
      "Roll one D6 for each model in this unit within Engagement Range of that enemy unit",
      "Roll one D6 for each model in this unit that has a Zorb",
    ]) {
      expect(errorsOf(text(wording), body(wording)).join(" "), wording).toMatch(/narrows the models/u);
    }
  });
});

describe("S8 roll-recipient exclusion", () => {
  const WORDING = "change the result of one Hit roll, one Wound roll or one Damage roll made for a model in that unit (excluding Zorb Support models) to an unmodified 6";
  const text = `Once per phase, ${WORDING}.`;
  const usage: Item = ["Once per phase", "usage-limit", { frequency: "once-per-phase", per: "model" }];
  const roll: Item = [WORDING, "roll-auto-result", { rolls: ["hit", "wound", "damage"], outcome: "counts-as-6", count: 1, weapon_type: "all" }];
  const model: Item = ["model", "unit-filter", { side: "friendly", level: "model" }, "RAW_TEXT", "in"];
  const member: Item = ["in that unit", "membership", { relation: "in", of: "this-unit" }, "RAW_TEXT", "in"];
  const exclusion: Item = ["excluding Zorb Support models", "unit-filter", { side: "friendly", level: "model", excluded_keywords: ["ZORB SUPPORT"] }, "RAW_TEXT", "in"];

  it("targets the models of that unit minus the excluded ones on every option", () => {
    const mechanics = mechanicsOf(text, [usage, roll, model, member, exclusion]);
    expect(mechanics.effect.type).toBe("choice");
    expect(mechanics.effect.options).toHaveLength(3);
    for (const [at, kind] of ["hit", "wound", "damage"].entries()) {
      expect(mechanics.effect.options[at]).toMatchObject({
        type: "roll-result",
        target: { owner: "friendly", level: "model", member_of: "this-unit", none_of: ["ZORB SUPPORT"] },
        modifier: { roll: kind, count: 1, result: 6 },
      });
    }
    expect(mechanics.usage).toEqual({ frequency: "once-per-phase", per: "model" });
    validates(mechanics.effect);
  });

  it("without the exclusion the target has no none_of", () => {
    const mechanics = mechanicsOf(text.replace(" (excluding Zorb Support models)", ""), [usage, [WORDING.replace(" (excluding Zorb Support models)", ""), "roll-auto-result", roll[2]], model, member]);
    expect(mechanics.effect.options[0].target).toEqual({ owner: "friendly", level: "model", member_of: "this-unit" });
  });

  it("a unit-level filter after the roll is still refused", () => {
    const wording = "change the result of one Hit roll made for a unit in that unit to an unmodified 6";
    const errors = errorsOf(`Once per phase, ${wording}.`, [usage, [wording, "roll-auto-result", { roll: "hit", outcome: "counts-as-6", count: 1, weapon_type: "all" }], ["unit", "unit-filter", { side: "friendly" }, "RAW_TEXT", "in"]]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("mergedFilter keeps the unit the models belong to and refuses two different units", () => {
    const leaf = (parameters: Record<string, unknown>): CompileLeaf => ({ role: "EFFECT", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"), parameters, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" });
    const merged = mergedFilter(leaf({ side: "friendly", level: "model", member_of: "this-unit" }), leaf({ side: "friendly", level: "model", excluded_keywords: ["ZORB SUPPORT"] }));
    expect(merged?.parameters).toMatchObject({ member_of: "this-unit", excluded_keywords: ["ZORB SUPPORT"] });
    expect(mergedFilter(leaf({ side: "friendly", level: "model", member_of: "this-unit" }), leaf({ side: "friendly", level: "model", member_of: "selected-unit" }))).toBeNull();
  });
});
